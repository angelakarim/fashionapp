/**
 * Fixed-window in-memory rate limiter.
 *
 * IMPORTANT LIMITATION: this state lives in a single serverless instance's
 * memory. Vercel runs several instances and recycles them, so the real ceiling
 * is roughly (limit x instances) and resets on cold start. It raises the cost
 * of casual abuse but is NOT a hard guarantee.
 *
 * For a durable limit, back this with Vercel KV / Upstash Redis and swap the
 * Map for an atomic INCR + EXPIRE. The call signature can stay the same.
 */
type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/** Drop expired entries so the Map can't grow without bound. */
function sweep(now: number) {
  if (windows.size < 5000) return;
  for (const [key, win] of windows) {
    if (win.resetAt <= now) windows.delete(key);
  }
}

export type RateLimitResult = { ok: boolean; retryAfterSeconds: number };

const exceeded = (resetAt: number, now: number): RateLimitResult => ({
  ok: false,
  retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
});

/** Check whether `key` is already over `limit`, without spending a slot. */
export function checkLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) return { ok: true, retryAfterSeconds: 0 };
  if (existing.count >= limit) return exceeded(existing.resetAt, now);
  return { ok: true, retryAfterSeconds: 0 };
}

/** Spend one slot against `key`, returning whether it was allowed. */
export function consumeLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > limit) return exceeded(existing.resetAt, now);
  return { ok: true, retryAfterSeconds: 0 };
}

/**
 * Best-effort client identity. On Vercel, x-forwarded-for is set by the edge
 * and its FIRST entry is the real client; later entries are attacker-controllable
 * and must not be trusted.
 */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
