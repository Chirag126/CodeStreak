import 'server-only';

import { checkableDay } from '@codestreak/shared';
import {
  collectGithubCommits,
  createGithubGet,
  evaluateGithubDay,
  explainGithubDay,
  githubRulesFromDocument,
  SKIP_REASON_TEXT,
  type GithubRulesDocument,
} from '@codestreak/shared/verification';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { createSupabaseServerClient } from '@/lib/supabase/server';

/** One manual check per member per minute (keeps the GitHub budget for everyone). */
export const CHECK_COOLDOWN_SECS = 60;

export type DayCheckResult = { ok: true; day: number } | { ok: false; error: string; retryAfterSecs?: number };

const secs = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/**
 * Checks a member's current day on GitHub and stores what was seen:
 *   - `evidence`: one row per commit pushed in the day (counted or not, with the reason in words);
 *   - `member_day_checks`: the summary (lines, goal, explanations), which also updates open boards.
 * This is a preview while the day runs; the final result is recorded after the day ends.
 * All data comes from GitHub and the database, never from the browser.
 */
export async function checkMemberDay(profileId: string, challengeAddress: string): Promise<DayCheckResult> {
  const admin = createSupabaseAdminClient();
  const { data: c } = await admin
    .from('challenges')
    .select('id, rules, pool_state, start_at, day_length_secs, num_days, join_deadline_at, verify_window_secs, dispute_window_secs')
    .eq('onchain_address', challengeAddress)
    .maybeSingle();
  if (!c) return { ok: false, error: 'Challenge not found.' };
  const { data: m } = await admin.from('memberships').select('id, status').eq('challenge_id', c.id).eq('profile_id', profileId).maybeSingle();
  if (!m) return { ok: false, error: 'Only players of this challenge can check their day.' };

  const githubDoc = (c.rules as { github?: GithubRulesDocument | null } | null)?.github;
  if (!githubDoc) return { ok: false, error: "This challenge doesn't count GitHub activity." };

  const now = Math.floor(Date.now() / 1000);
  const slot = checkableDay(
    {
      state: c.pool_state as 'open' | 'cancelled' | 'settled',
      startTs: secs(c.start_at as string),
      dayLengthSecs: c.day_length_secs as number,
      numDays: c.num_days as number,
      joinDeadlineTs: secs(c.join_deadline_at as string),
      verifyWindowSecs: c.verify_window_secs as number,
      disputeWindowSecs: c.dispute_window_secs as number,
    },
    now,
  );
  if (!slot.ok) {
    return {
      ok: false,
      error: { not_started: "The challenge hasn't started yet: checks open on day 1.", over: 'Checking has closed: results are final.', cancelled: 'This challenge was cancelled.' }[slot.reason],
    };
  }

  const { data: account } = await admin.from('linked_accounts').select('provider_user_id').eq('profile_id', profileId).eq('provider', 'github').maybeSingle();
  if (!account) return { ok: false, error: 'Link your GitHub account in Dashboard → Settings first.' };
  const githubId = Number(account.provider_user_id);

  const { data: last } = await admin
    .from('member_day_checks')
    .select('checked_at')
    .eq('membership_id', m.id)
    .eq('day', slot.day)
    .eq('provider', 'github')
    .maybeSingle();
  const since = last ? now - secs(last.checked_at as string) : Number.POSITIVE_INFINITY;
  if (since < CHECK_COOLDOWN_SECS) {
    const wait = CHECK_COOLDOWN_SECS - since;
    return { ok: false, error: `Checked ${since}s ago. You can check again in ${wait}s.`, retryAfterSecs: wait };
  }

  // Commits already considered on earlier days don't count again (same SHA or same change).
  const { data: earlier } = await admin
    .from('evidence')
    .select('external_id, diff_hash, counted, day')
    .eq('membership_id', m.id)
    .eq('provider', 'github')
    .neq('day', slot.day)
    .limit(5000);
  const seen = {
    shas: new Set((earlier ?? []).map((e) => e.external_id as string)),
    diffHashes: new Set((earlier ?? []).filter((e) => e.counted && e.diff_hash).map((e) => e.diff_hash as string)),
  };

  const { data: run } = await admin.from('verification_runs').insert({ challenge_id: c.id, day: slot.day, triggered_by: 'manual' }).select('id').single();
  const finishRun = (status: 'succeeded' | 'partial' | 'failed', checked: number, error?: string) =>
    run ? admin.from('verification_runs').update({ status, finished_at: new Date().toISOString(), checked_count: checked, error: error?.slice(0, 2000) ?? null }).eq('id', run.id) : null;

  const rules = githubRulesFromDocument(githubDoc);
  let data;
  try {
    data = await collectGithubCommits({ get: createGithubGet(process.env.GITHUB_API_TOKEN || undefined), githubId, window: slot.window, repoIds: rules.repos ?? null });
  } catch (e) {
    await finishRun('failed', 0, e instanceof Error ? e.message : 'collect failed');
    return { ok: false, error: 'GitHub could not be reached. Try again in a minute.' };
  }
  const day = evaluateGithubDay({ commits: data.commits, userGithubId: githubId, window: slot.window, rules, seen });
  const hints = explainGithubDay(data, day, rules.minMeaningfulLines, { selectedRepos: (rules.repos ?? []).length > 0 });

  // Evidence for this day: replace the previous check's rows (force pushes can remove commits).
  const inDay = [
    ...day.counted.map((x) => ({ sha: x.sha, repo: x.repo, counted: true, lines: x.meaningfulLines, diffHash: x.diffHash, reason: 'Counted.', code: 'counted' })),
    ...day.skipped
      .filter((x) => x.reason !== 'outside-day' && !seen.shas.has(x.sha))
      .map((x) => ({ sha: x.sha, repo: x.repo, counted: false, lines: 0, diffHash: null as string | null, reason: SKIP_REASON_TEXT[x.reason], code: x.reason })),
  ];
  const pushedAt = new Map(data.commits.map((x) => [x.sha, x.pushedAt]));
  await admin.from('evidence').delete().eq('membership_id', m.id).eq('provider', 'github').eq('day', slot.day);
  if (inDay.length) {
    const { error } = await admin.from('evidence').insert(
      inDay.slice(0, 200).map((x) => ({
        membership_id: m.id,
        run_id: run?.id ?? null,
        day: slot.day,
        provider: 'github',
        kind: 'commit',
        external_id: x.sha,
        occurred_at: pushedAt.get(x.sha) ?? new Date().toISOString(),
        diff_hash: x.counted ? x.diffHash : null,
        counted: x.counted,
        reason: x.reason,
        details: { repo: x.repo, lines: x.lines, code: x.code },
      })),
    );
    if (error) console.error('[check] evidence write failed:', error.message);
  }

  const { error: summaryError } = await admin.from('member_day_checks').upsert(
    {
      membership_id: m.id,
      day: slot.day,
      provider: 'github',
      run_id: run?.id ?? null,
      lines: day.meaningfulLines,
      goal: rules.minMeaningfulLines,
      breakdown: day.breakdown,
      outcome: day.meetsThreshold ? 'met' : data.complete && day.missingPatches === 0 ? 'not_met' : 'unknown',
      complete: data.complete,
      pushes: data.pushes,
      commits: inDay.length,
      hints,
      notes: data.notes.slice(0, 12),
      checked_by: profileId,
      checked_at: new Date().toISOString(),
    },
    { onConflict: 'membership_id,day,provider' },
  );
  await finishRun(data.complete ? 'succeeded' : 'partial', inDay.length);
  if (summaryError) return { ok: false, error: 'The check ran but could not be saved. Try again.' };
  return { ok: true, day: slot.day };
}

export interface DayLog {
  day: number;
  lines: number;
  goal: number;
  outcome: 'met' | 'not_met' | 'unknown';
  complete: boolean;
  pushes: number;
  hints: string[];
  notes: string[];
  checkedAt: string;
  commits: { sha: string; repo: string; counted: boolean; lines: number; reason: string; pushedAt: string }[];
}

/**
 * A member's checks for a day, read with the VIEWER's session: the database decides visibility
 * (the member's "share check details" and the creator's "players only" settings).
 */
export async function readDayLog(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  membershipId: string,
  day: number,
): Promise<DayLog | null> {
  const { data: s } = await supabase
    .from('member_day_checks')
    .select('day, lines, goal, outcome, complete, pushes, hints, notes, checked_at')
    .eq('membership_id', membershipId)
    .eq('day', day)
    .eq('provider', 'github')
    .maybeSingle();
  if (!s) return null;
  const { data: rows } = await supabase
    .from('evidence')
    .select('external_id, counted, reason, details, occurred_at')
    .eq('membership_id', membershipId)
    .eq('day', day)
    .eq('provider', 'github')
    .order('counted', { ascending: false })
    .order('occurred_at', { ascending: true })
    .limit(200);
  return {
    day: s.day as number,
    lines: s.lines as number,
    goal: s.goal as number,
    outcome: s.outcome as DayLog['outcome'],
    complete: s.complete as boolean,
    pushes: s.pushes as number,
    hints: (s.hints as string[]) ?? [],
    notes: (s.notes as string[]) ?? [],
    checkedAt: s.checked_at as string,
    commits: (rows ?? []).map((r) => {
      const d = (r.details ?? {}) as { repo?: string; lines?: number };
      return { sha: r.external_id as string, repo: d.repo ?? '', counted: r.counted as boolean, lines: d.lines ?? 0, reason: r.reason as string, pushedAt: r.occurred_at as string };
    }),
  };
}
