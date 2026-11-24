// Short-lived cache for read-only Solana RPC calls made while rendering pages.
//
// Why: the public devnet RPC rate-limits (HTTP 429). web3.js then retries with backoff, so one
// page render could take 20+ seconds, and several tabs or live refreshes multiplied the calls.
// Here, concurrent reads of the same key share one request, a fresh value is reused for `ttlMs`,
// and when the RPC fails the last good value (up to `staleMs` old) is served instead of an error.
// Writes and transaction checks never go through this.

interface Entry<T> {
  value?: T;
  at: number;
  inflight?: Promise<T>;
}

const entries = new Map<string, Entry<unknown>>();
const MAX_ENTRIES = 500;

export async function cachedRead<T>(key: string, ttlMs: number, read: () => Promise<T>, staleMs = 5 * 60_000, now = Date.now): Promise<T> {
  const e = (entries.get(key) as Entry<T> | undefined) ?? { at: 0 };
  if ('value' in e && now() - e.at < ttlMs) return e.value as T;
  if (e.inflight) return e.inflight;
  const p = read().then(
    (value) => {
      entries.set(key, { value, at: now() });
      if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
      return value;
    },
    (err: unknown) => {
      const last = entries.get(key) as Entry<T> | undefined;
      entries.set(key, { ...last, at: last?.at ?? 0, inflight: undefined });
      if (last && 'value' in last && now() - last.at < staleMs) return last.value as T;
      throw err;
    },
  );
  entries.set(key, { ...e, inflight: p });
  return p;
}

const lastRun = new Map<string, number>();

/** Runs `fn` at most once per `minIntervalMs` per key on this server (background syncs). */
export function throttled(key: string, minIntervalMs: number, fn: () => Promise<unknown>, now = Date.now): Promise<unknown> | null {
  const t = now();
  if (t - (lastRun.get(key) ?? 0) < minIntervalMs) return null;
  lastRun.set(key, t);
  return fn();
}

/** For tests. */
export function resetReadCache() {
  entries.clear();
  lastRun.clear();
}
