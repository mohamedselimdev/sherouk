import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export const TEST_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://shrouk:shrouk_local_only@127.0.0.1:54329/shrouk_test";

export default async function setup() {
  const client = postgres(TEST_URL, { max: 1 });
  await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
  await client.end();
}
