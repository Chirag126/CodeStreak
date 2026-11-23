// Minimal Supabase REST client for the worker (service role; the worker has no supabase-js).
// Transient failures (5xx, network) are retried; 4xx answers are final and surface their message.
import { isTransientError, withRetry, type RetryOptions } from '@codestreak/shared';

export interface Db {
  rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T>;
  /** `query` is a PostgREST query string, e.g. "select=id,day&membership_id=eq.<uuid>". */
  select<T = Record<string, unknown>>(table: string, query: string): Promise<T[]>;
  insert(table: string, rows: unknown, options?: { onConflict?: string; ignoreDuplicates?: boolean }): Promise<void>;
  update(table: string, filter: string, patch: Record<string, unknown>): Promise<void>;
}

export class DbError extends Error {}

export function createRestDb(url: string, serviceRoleKey: string, fetchImpl: typeof fetch = fetch, retry: RetryOptions = {}): Db {
  const base = `${url.replace(/\/$/, '')}/rest/v1`;
  const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' };
  const call = (what: string, path: string, init: RequestInit) =>
    withRetry(async () => {
      const res = await fetchImpl(`${base}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
      const text = await res.text();
      if (!res.ok) {
        const message = (() => {
          try {
            return (JSON.parse(text) as { message?: string }).message ?? text;
          } catch {
            return text;
          }
        })();
        throw new DbError(`${what}: HTTP ${res.status} ${message}`.slice(0, 400));
      }
      return text ? (JSON.parse(text) as unknown) : null;
    }, { ...retry, retryable: (e) => isTransientError(e) || /HTTP 5\d\d/.test(String(e)) });

  return {
    rpc: async (fn, args = {}) => (await call(`rpc ${fn}`, `/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })) as never,
    select: async (table, query) => ((await call(`select ${table}`, `/${table}?${query}`, { method: 'GET' })) ?? []) as never,
    insert: async (table, rows, options = {}) => {
      const prefer = ['return=minimal', options.onConflict ? `resolution=${options.ignoreDuplicates ? 'ignore' : 'merge'}-duplicates` : ''].filter(Boolean).join(',');
      const q = options.onConflict ? `?on_conflict=${options.onConflict}` : '';
      await call(`insert ${table}`, `/${table}${q}`, { method: 'POST', body: JSON.stringify(rows), headers: { Prefer: prefer } });
    },
    update: async (table, filter, patch) => {
      await call(`update ${table}`, `/${table}?${filter}`, { method: 'PATCH', body: JSON.stringify(patch), headers: { Prefer: 'return=minimal' } });
    },
  };
}
