import type { Job } from '../server.js';

export interface WakeOptions {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  version: string;
  fetchImpl?: typeof fetch;
}

/**
 * Called by Supabase pg_cron (through pg_net) on a schedule. Waking the free Render instance is the
 * point; it also writes a `worker.wake` row to the audit log so each wake is visible in the database.
 */
export function createWakeJob(options: WakeOptions): Job {
  const doFetch = options.fetchImpl ?? fetch;
  return async ({ log }) => {
    const at = new Date().toISOString();
    if (!options.supabaseUrl || !options.serviceRoleKey) {
      log('awake (audit log skipped: Supabase service role not configured)');
      return { awake: true, at, audited: false };
    }
    const res = await doFetch(`${options.supabaseUrl}/rest/v1/audit_log`, {
      method: 'POST',
      headers: {
        apikey: options.serviceRoleKey,
        Authorization: `Bearer ${options.serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        actor_kind: 'worker',
        action: 'worker.wake',
        entity_type: 'worker',
        entity_id: 'codestreak-worker',
        details: { version: options.version, at },
      }),
    });
    if (!res.ok) throw new Error(`audit log write failed: HTTP ${res.status}`);
    log('awake (recorded in audit_log)');
    return { awake: true, at, audited: true };
  };
}
