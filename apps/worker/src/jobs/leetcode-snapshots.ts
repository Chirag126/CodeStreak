import { readLeetcodeSnapshot } from '@codestreak/shared/verification';
import type { Job } from '../server.js';

export interface LeetcodeSnapshotOptions {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  firecrawlApiKey?: string;
  fetchImpl?: typeof fetch;
  /** Profiles per run (each costs ~1 Firecrawl credit). */
  maxPerRun?: number;
}

/**
 * Scheduled LeetCode snapshots (pg_cron → worker, every 30 minutes): for each player in a running
 * LeetCode challenge whose newest snapshot is older than 25 minutes, read their public profile
 * live and store it. These snapshots are the "midnight anchors" and the in-day evidence.
 */
export function createLeetcodeSnapshotJob(options: LeetcodeSnapshotOptions): Job {
  const doFetch = options.fetchImpl ?? fetch;
  return async ({ log }) => {
    const { supabaseUrl, serviceRoleKey, firecrawlApiKey } = options;
    if (!supabaseUrl || !serviceRoleKey || !firecrawlApiKey) {
      log('skipped: Supabase service role or FIRECRAWL_API_KEY not configured');
      return { skipped: true };
    }
    const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' };
    const targetsRes = await doFetch(`${supabaseUrl}/rest/v1/rpc/leetcode_snapshot_targets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ max_rows: options.maxPerRun ?? 15 }),
    });
    if (!targetsRes.ok) throw new Error(`targets query failed: HTTP ${targetsRes.status}`);
    const targets = (await targetsRes.json()) as { profile_id: string; handle: string }[];

    let stored = 0;
    let unreadable = 0;
    for (const t of targets) {
      const row = await readLeetcodeSnapshot(firecrawlApiKey, t.profile_id, t.handle, 'scheduled', doFetch);
      const res = await doFetch(`${supabaseUrl}/rest/v1/leetcode_snapshots`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      if (!res.ok) throw new Error(`snapshot insert failed: HTTP ${res.status}`);
      stored++;
      if (!row.readable) unreadable++;
    }
    log(`leetcode snapshots: ${stored} stored (${unreadable} unreadable) of ${targets.length} due`);
    return { due: targets.length, stored, unreadable };
  };
}
