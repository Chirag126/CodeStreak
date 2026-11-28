/**
 * Per-address request caps for the public, signed-out endpoints (Blinks, widgets, embeds, live boards).
 * In memory and per server instance: the app runs as one instance, and this only has to stop one
 * client from hammering the database and RPC, not count exactly. Signed-in money actions have their
 * own database-backed limits (relayer, reports, appeals, sign-in attempts).
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 20_000;

export type LimitRule = { name: string; limit: number; windowMs: number };

/** Public reads (widgets, embeds, icons, Blink metadata, live boards). */
export const PUBLIC_READ: LimitRule = { name: 'read', limit: 120, windowMs: 60_000 };
/** Blink transaction builds and callbacks (each one does database + RPC work). */
export const ACTION_WRITE: LimitRule = { name: 'action', limit: 20, windowMs: 60_000 };

/** Best-effort client address (Render sets x-forwarded-for; the first entry is the client). */
export function clientAddress(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (forwarded || req.headers.get('x-real-ip')?.trim() || 'unknown').slice(0, 64);
}

/** Counts one request; returns how long to wait (seconds) when over the limit, else 0. */
export function takeToken(key: string, rule: LimitRule, now = Date.now()): number {
  if (buckets.size > MAX_KEYS) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    if (buckets.size > MAX_KEYS) buckets.clear(); // still full: start over rather than grow without bound
  }
  const id = `${rule.name}:${key}`;
  const b = buckets.get(id);
  if (!b || b.resetAt <= now) {
    buckets.set(id, { count: 1, resetAt: now + rule.windowMs });
    return 0;
  }
  b.count += 1;
  return b.count > rule.limit ? Math.max(1, Math.ceil((b.resetAt - now) / 1000)) : 0;
}

/** Seconds to wait for this request (0 = go ahead). */
export function overLimit(req: Request, rule: LimitRule): number {
  return takeToken(clientAddress(req), rule);
}

/** Voice briefings and announcements (signed in; each may call ElevenLabs). */
export const VOICE: LimitRule = { name: 'voice', limit: 12, windowMs: 60_000 };

/** Plain 429 for non-Blink endpoints. */
export function tooManyRequests(retryAfter: number): Response {
  return new Response(JSON.stringify({ error: `Too many requests. Try again in ${retryAfter} s.` }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' },
  });
}

/** For tests. */
export function resetRateLimits(): void {
  buckets.clear();
}
