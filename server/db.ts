import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../db/schema";

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type DbHandle = { db: Db; close: () => Promise<void> };

/**
 * One short-lived connection pool per request (Workers cannot keep sockets between requests).
 * `prepare: false` and no type fetching are required behind Hyperdrive/pgbouncer-style pooling.
 */
export function createDb(connectionString: string, max = 4): DbHandle {
  const client = postgres(connectionString, {
    max,
    prepare: false,
    fetch_types: false,
    idle_timeout: 5,
    connect_timeout: 10,
  });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 2 }) };
}

export { schema };
