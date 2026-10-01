import { createHmac } from "node:crypto";
import type { Pool } from "pg";
export function anonymousKey(ip: string, dailySecret: string, day = new Date().toISOString().slice(0, 10)): string { return createHmac("sha256", dailySecret).update(`${day}:${ip}`).digest("hex"); }
export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };
export function decideWindow(events: readonly number[], now: number, windowMs: number, max: number): RateLimitResult { const recent = events.filter((timestamp) => timestamp > now - windowMs); return recent.length < max ? { allowed: true, retryAfterSeconds: 0 } : { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000)) }; }
export async function consumePostgresWindow(pool: Pool, scope: string, subjectHash: string, windowSeconds: number, max: number): Promise<RateLimitResult> {
  const result = await pool.query("SELECT * FROM chibbo.consume_rate_limit($1,$2,$3,$4)", [scope, subjectHash, windowSeconds, max]);
  const row = result.rows[0];
  if (!row) throw new Error("rate limit result missing");
  return { allowed: Boolean(row.allowed), retryAfterSeconds: Number(row.retry_after_seconds) };
}
