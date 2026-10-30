/**
 * Local development PostgreSQL (real Postgres binaries, no Docker). Not used outside development.
 * Starts a server on 127.0.0.1:54329 with databases `shrouk_dev` and `shrouk_test`; stop with Ctrl+C.
 */
import { existsSync } from "node:fs";
import EmbeddedPostgres from "embedded-postgres";

const dir = ".dev-db/data";
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "shrouk",
  password: "shrouk_local_only",
  port: 54329,
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

if (!existsSync(`${dir}/PG_VERSION`)) await pg.initialise();
await pg.start();
for (const name of ["shrouk_dev", "shrouk_test"]) {
  try {
    await pg.createDatabase(name);
  } catch {
    /* database already exists */
  }
}
console.log("dev postgres ready on 127.0.0.1:54329 (databases: shrouk_dev, shrouk_test)");

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
