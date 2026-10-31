/**
 * Backup and restore drill, no external tools needed.
 *
 *   DATABASE_URL=<source> npm run db:backup-drill
 *
 * Exports every public table to NDJSON, restores the export into a scratch database built from the checked-in
 * migrations, then compares row counts and a content checksum per table. The scratch database is dropped at the end.
 * The export contains personal data and password hashes: it is written under artifacts/ (gitignored) and deleted
 * unless KEEP_DUMP=1. For production use the provider's point-in-time recovery and run this drill against a
 * restored copy, never against the live database.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const source = process.env.DATABASE_URL ?? "postgres://shrouk:shrouk_local_only@127.0.0.1:54329/shrouk_dev";
const scratchName = `shrouk_restore_drill_${Date.now()}`;
const adminUrl = source.replace(/\/[^/?]+(\?.*)?$/, "/postgres$1");
const scratchUrl = source.replace(/\/[^/?]+(\?.*)?$/, `/${scratchName}$1`);
const dir = `artifacts/backup/${new Date().toISOString().replace(/[:.]/g, "-")}`;
const CHUNK = 500;

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const src = postgres(source, { max: 1, onnotice: () => {} });
const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });

type Report = { table: string; rows: number; restored: number; sameChecksum: boolean };
const reports: Report[] = [];

try {
  const tables = (
    await src<{ tablename: string }[]>`
      select tablename from pg_tables
      where schemaname = 'public' and tablename <> '__drizzle_migrations' order by tablename`
  ).map((r) => r.tablename);

  mkdirSync(dir, { recursive: true });
  const checksum = async (db: postgres.Sql, t: string) =>
    (
      await db.unsafe<{ c: string }[]>(
        `select coalesce(md5(string_agg(x::text, '' order by x::text)), '') as c from (select row_to_json(t) as x from ${quote(t)} t) s`,
      )
    )[0]!.c;

  const counts = new Map<string, number>();
  const sums = new Map<string, string>();
  for (const t of tables) {
    const rows = await src.unsafe<{ j: unknown }[]>(`select row_to_json(t) as j from ${quote(t)} t`);
    writeFileSync(`${dir}/${t}.ndjson`, rows.map((r) => JSON.stringify(r.j)).join("\n"));
    counts.set(t, rows.length);
    sums.set(t, await checksum(src, t));
  }

  await admin.unsafe(`create database ${quote(scratchName)}`);
  const scratch = postgres(scratchUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(scratch), { migrationsFolder: "db/migrations" });
    // Constraints are deferred for the load; the checksum comparison below proves the data arrived intact.
    await scratch.unsafe("set session_replication_role = replica");
    for (const t of tables) {
      const lines = (await import("node:fs"))
        .readFileSync(`${dir}/${t}.ndjson`, "utf8")
        .split("\n")
        .filter(Boolean);
      for (let i = 0; i < lines.length; i += CHUNK) {
        const batch = `[${lines.slice(i, i + CHUNK).join(",")}]`;
        await scratch.unsafe(
          `insert into ${quote(t)} select * from json_populate_recordset(null::${quote(t)}, $1::json)`,
          [batch],
        );
      }
      const restored = (
        await scratch.unsafe<{ n: number }[]>(`select count(*)::int as n from ${quote(t)}`)
      )[0]!.n;
      reports.push({
        table: t,
        rows: counts.get(t)!,
        restored,
        sameChecksum: (await checksum(scratch, t)) === sums.get(t),
      });
    }
  } finally {
    await scratch.end();
    await admin.unsafe(`drop database if exists ${quote(scratchName)} with (force)`);
  }
} finally {
  await src.end();
  await admin.end();
  if (process.env.KEEP_DUMP !== "1") rmSync(dir, { recursive: true, force: true });
}

const bad = reports.filter((r) => r.rows !== r.restored || !r.sameChecksum);
for (const r of reports) {
  console.log(
    `${r.rows === r.restored && r.sameChecksum ? "ok " : "BAD"} ${r.table.padEnd(28)} ${r.rows} -> ${r.restored}`,
  );
}
console.log(
  bad.length
    ? `restore drill FAILED for ${bad.length} table(s)`
    : `restore drill passed: ${reports.length} tables, ${reports.reduce((s, r) => s + r.rows, 0)} rows`,
);
process.exit(bad.length ? 1 : 0);
