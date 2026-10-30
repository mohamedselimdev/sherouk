import { sql } from "drizzle-orm";
import type { Db } from "../db";
import { rateLimits } from "../../db/schema";

export class TooManyRequestsError extends Error {
  constructor(public retryAfterSeconds: number) {
    super("Too many requests");
    this.name = "TooManyRequestsError";
  }
}

/**
 * Fixed-window counter in Postgres (works across Worker isolates, unlike memory).
 * Increments atomically and throws once `limit` is exceeded inside the window.
 */
export async function hit(db: Db, key: string, limit: number, windowSeconds: number): Promise<void> {
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, resetAt: sql`now() + make_interval(secs => ${windowSeconds})` })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.resetAt} <= now() then 1 else ${rateLimits.count} + 1 end`,
        resetAt: sql`case when ${rateLimits.resetAt} <= now() then now() + make_interval(secs => ${windowSeconds}) else ${rateLimits.resetAt} end`,
      },
    })
    .returning({
      count: rateLimits.count,
      wait: sql<number>`greatest(1, ceil(extract(epoch from (${rateLimits.resetAt} - now()))))::int`,
    });
  if (row && row.count > limit) throw new TooManyRequestsError(row.wait);
}

export async function resetKey(db: Db, key: string): Promise<void> {
  await db.delete(rateLimits).where(sql`${rateLimits.key} = ${key}`);
}
