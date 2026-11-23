import 'server-only';

import { checkableDay, providerConfidence, type ProviderOutcome } from '@codestreak/shared';
import {
  collectGithubCommits,
  createGithubGet,
  evaluateGithubDay,
  githubEvaluation,
  LEETCODE_FINAL_GRACE_SECS,
  leetcodeEvaluation,
  explainGithubDay,
  explainLeetcodeDay,
  githubRulesFromDocument,
  leetcodeRulesFromDocument,
  scrapeLeetcodeProfile,
  SKIP_REASON_TEXT,
  snapshotRecordFromRow,
  snapshotRowFromScrape,
  type GithubRulesDocument,
  type LeetcodeRulesDocument,
  type SnapshotRow,
} from '@codestreak/shared/verification';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { createSupabaseServerClient } from '@/lib/supabase/server';

/** One manual check per member per minute (keeps the GitHub and Firecrawl budgets for everyone). */
export const CHECK_COOLDOWN_SECS = 60;

export type Provider = 'github' | 'leetcode';
export type DayCheckResult = { ok: true; day: number; providers: Provider[] } | { ok: false; error: string; retryAfterSecs?: number };

type Admin = ReturnType<typeof createSupabaseAdminClient>;
type Window = { startSec: number; endSec: number };
const secs = (iso: string) => Math.floor(Date.parse(iso) / 1000);

interface Summary {
  /** The engine's view (rules-engine.ts): outcome and confidence, as the final receipt will use them. */
  engineOutcome: ProviderOutcome;
  confidence: number;
  lines: number;
  goal: number;
  outcome: 'met' | 'not_met' | 'unknown';
  complete: boolean;
  pushes: number;
  breakdown: Record<string, unknown>;
  hints: string[];
  notes: string[];
}
interface EvidenceRow {
  id: string;
  counted: boolean;
  reason: string;
  occurredAt: string;
  diffHash: string | null;
  details: Record<string, unknown>;
}

/** Replaces a member's evidence for one provider and day, then stores the day's summary. */
async function saveDay(admin: Admin, input: { membershipId: string; day: number; provider: Provider; runId: string | null; profileId: string; evidence: EvidenceRow[]; summary: Summary }) {
  const { membershipId, day, provider } = input;
  await admin.from('evidence').delete().eq('membership_id', membershipId).eq('provider', provider).eq('day', day);
  if (input.evidence.length) {
    const { error } = await admin.from('evidence').insert(
      input.evidence.slice(0, 200).map((e) => ({
        membership_id: membershipId,
        run_id: input.runId,
        day,
        provider,
        kind: provider === 'github' ? 'commit' : 'submission',
        external_id: e.id,
        occurred_at: e.occurredAt,
        diff_hash: provider === 'github' && e.counted ? e.diffHash : null,
        counted: e.counted,
        reason: e.reason.slice(0, 200),
        details: e.details,
      })),
    );
    if (error) console.error(`[check] ${provider} evidence write failed:`, error.message);
  }
  const s = input.summary;
  return admin.from('member_day_checks').upsert(
    {
      membership_id: membershipId,
      day,
      provider,
      run_id: input.runId,
      lines: s.lines,
      goal: s.goal,
      breakdown: { ...s.breakdown, engineOutcome: s.engineOutcome },
      confidence: s.confidence,
      outcome: s.outcome,
      complete: s.complete,
      pushes: s.pushes,
      commits: input.evidence.length,
      hints: s.hints.slice(0, 12),
      notes: s.notes.slice(0, 12),
      checked_by: input.profileId,
      checked_at: new Date().toISOString(),
    },
    { onConflict: 'membership_id,day,provider' },
  );
}

// ---------------------------------------------------------------- GitHub

async function checkGithub(admin: Admin, a: { profileId: string; membershipId: string; day: number; window: Window; doc: GithubRulesDocument; runId: string | null }): Promise<string | null> {
  const { data: account } = await admin.from('linked_accounts').select('provider_user_id').eq('profile_id', a.profileId).eq('provider', 'github').maybeSingle();
  if (!account) return 'GitHub is not linked (Dashboard → Settings).';
  const githubId = Number(account.provider_user_id);
  // Commits already considered on earlier days don't count again (same SHA or same change).
  const { data: earlier } = await admin.from('evidence').select('external_id, diff_hash, counted').eq('membership_id', a.membershipId).eq('provider', 'github').neq('day', a.day).limit(5000);
  const seen = {
    shas: new Set((earlier ?? []).map((e) => e.external_id as string)),
    diffHashes: new Set((earlier ?? []).filter((e) => e.counted && e.diff_hash).map((e) => e.diff_hash as string)),
  };
  const rules = githubRulesFromDocument(a.doc);
  const data = await collectGithubCommits({ get: createGithubGet(process.env.GITHUB_API_TOKEN || undefined), githubId, window: a.window, repoIds: rules.repos ?? null });
  const day = evaluateGithubDay({ commits: data.commits, userGithubId: githubId, window: a.window, rules, seen });
  const pushedAt = new Map(data.commits.map((x) => [x.sha, x.pushedAt]));
  const evidence: EvidenceRow[] = [
    ...day.counted.map((x) => ({ id: x.sha, counted: true, reason: 'Counted.', occurredAt: pushedAt.get(x.sha) ?? new Date().toISOString(), diffHash: x.diffHash, details: { repo: x.repo, lines: x.meaningfulLines, code: 'counted' } })),
    ...day.skipped
      .filter((x) => x.reason !== 'outside-day' && !seen.shas.has(x.sha))
      .map((x) => ({ id: x.sha, counted: false, reason: SKIP_REASON_TEXT[x.reason], occurredAt: pushedAt.get(x.sha) ?? new Date().toISOString(), diffHash: null, details: { repo: x.repo, lines: 0, code: x.reason } })),
  ];
  const engine = githubEvaluation(day, data, rules.minMeaningfulLines);
  const { error } = await saveDay(admin, {
    membershipId: a.membershipId,
    day: a.day,
    provider: 'github',
    runId: a.runId,
    profileId: a.profileId,
    evidence,
    summary: {
      engineOutcome: engine.outcome,
      confidence: providerConfidence(engine.outcome, engine.quality),
      lines: day.meaningfulLines,
      goal: rules.minMeaningfulLines,
      outcome: day.meetsThreshold ? 'met' : data.complete && day.missingPatches === 0 ? 'not_met' : 'unknown',
      complete: data.complete,
      pushes: data.pushes,
      breakdown: day.breakdown as unknown as Record<string, unknown>,
      hints: explainGithubDay(data, day, rules.minMeaningfulLines, { selectedRepos: (rules.repos ?? []).length > 0 }),
      notes: data.notes,
    },
  });
  return error ? 'The GitHub check could not be saved.' : null;
}

// ---------------------------------------------------------------- LeetCode

/** Reads the public profile live and stores the snapshot (join, manual). Never throws. */
export async function takeLeetcodeSnapshot(profileId: string, source: 'join' | 'manual'): Promise<SnapshotRow | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  const admin = createSupabaseAdminClient();
  const { data: account } = await admin.from('linked_accounts').select('provider_user_id').eq('profile_id', profileId).eq('provider', 'leetcode').maybeSingle();
  if (!apiKey || !account) return null;
  const handle = account.provider_user_id as string;
  const row = snapshotRowFromScrape(await scrapeLeetcodeProfile(apiKey, handle), profileId, handle, source);
  const { data, error } = await admin.from('leetcode_snapshots').insert(row).select('observed_at').single();
  if (error) {
    console.error('[leetcode] snapshot write failed:', error.message);
    return null;
  }
  return { ...row, observed_at: data.observed_at as string };
}

async function checkLeetcode(admin: Admin, a: { profileId: string; membershipId: string; day: number; window: Window; doc: LeetcodeRulesDocument; runId: string | null }): Promise<string | null> {
  const { data: account } = await admin.from('linked_accounts').select('provider_user_id').eq('profile_id', a.profileId).eq('provider', 'leetcode').maybeSingle();
  if (!account) return 'LeetCode is not linked (Dashboard → Settings).';
  if (!process.env.FIRECRAWL_API_KEY) return 'LeetCode checks are not configured on this server (FIRECRAWL_API_KEY).';
  const handle = account.provider_user_id as string;
  await takeLeetcodeSnapshot(a.profileId, 'manual');

  const cols = 'observed_at, handle, readable, solved, easy, medium, hard, has_history, recent, error';
  const startIso = new Date(a.window.startSec * 1000).toISOString();
  // Up to 45 min after the day ends too: the final check must see a solve in the day's last minutes.
  const endIso = new Date((a.window.endSec + LEETCODE_FINAL_GRACE_SECS) * 1000).toISOString();
  // The anchor: the newest readable snapshot of THIS handle taken at or before the day started.
  const [{ data: anchorRow }, { data: dayRows }] = await Promise.all([
    admin.from('leetcode_snapshots').select(cols).eq('profile_id', a.profileId).eq('handle', handle).eq('readable', true).lte('observed_at', startIso).order('observed_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('leetcode_snapshots').select(cols).eq('profile_id', a.profileId).eq('handle', handle).gte('observed_at', startIso).lt('observed_at', endIso).order('observed_at', { ascending: true }).limit(200),
  ]);
  type Row = Parameters<typeof snapshotRecordFromRow>[0];
  const rules = leetcodeRulesFromDocument(a.doc);
  const { result, evaluation: engine } = leetcodeEvaluation({
    anchor: anchorRow ? snapshotRecordFromRow(anchorRow as unknown as Row) : null,
    daySnapshots: (dayRows ?? []).map((r) => snapshotRecordFromRow(r as unknown as Row)),
    window: a.window,
    rules,
    graceSecs: LEETCODE_FINAL_GRACE_SECS,
  });
  const at = new Date().toISOString();
  const link = (id: string) => ({ url: `https://leetcode.com/submissions/detail/${id}/` });
  const evidence: EvidenceRow[] = [
    ...result.newSolves.map((s, i) => ({
      id: s.submissionId,
      counted: i < result.credited,
      reason: i < result.credited ? 'New problem solved.' : "Not credited: your solved count didn't rise by this much.",
      occurredAt: at,
      diffHash: null,
      details: { title: s.title, ...link(s.submissionId), code: 'new-solve' },
    })),
    ...result.ignored.map((s) => ({
      id: s.submissionId,
      counted: false,
      reason: { 'already-solved-recently': 'A re-solve of a problem you had already solved.', 'before-the-day': 'Solved before the day started.', 'after-the-day': 'Solved after the day ended (counts for the next day).' }[s.reason],
      occurredAt: at,
      diffHash: null,
      details: { title: s.title, ...link(s.submissionId), code: s.reason },
    })),
    ...result.withdrawn.map((s) => ({
      id: s.submissionId,
      counted: false,
      reason: 'Seen earlier today, then disappeared from your profile.',
      occurredAt: at,
      diffHash: null,
      details: { title: s.title, ...link(s.submissionId), code: 'withdrawn' },
    })),
  ];
  const known = result.status === 'ok' || result.status === 'private';
  const { error } = await saveDay(admin, {
    membershipId: a.membershipId,
    day: a.day,
    provider: 'leetcode',
    runId: a.runId,
    profileId: a.profileId,
    evidence,
    summary: {
      engineOutcome: engine.outcome,
      confidence: providerConfidence(engine.outcome, engine.quality),
      lines: result.creditedAtLevel,
      goal: rules.minNewSolves,
      outcome: result.meetsThreshold ? 'met' : known ? 'not_met' : 'unknown',
      complete: known,
      pushes: (dayRows ?? []).length,
      breakdown: { solvedDelta: result.solvedDelta, levels: result.levels, minDifficulty: rules.minDifficulty, status: result.status },
      hints: explainLeetcodeDay(result, rules),
      notes: [],
    },
  });
  return error ? 'The LeetCode check could not be saved.' : null;
}

// ---------------------------------------------------------------- entry point

/**
 * Checks a member's current day for every provider the challenge counts, and stores what was
 * seen (evidence per commit or submission, plus a summary per provider). A preview while the day
 * runs; the final result is recorded after the day ends. All data comes from GitHub, LeetCode
 * (through Firecrawl) and the database, never from the browser.
 */
export async function checkMemberDay(profileId: string, challengeAddress: string): Promise<DayCheckResult> {
  const admin = createSupabaseAdminClient();
  const { data: c } = await admin
    .from('challenges')
    .select('id, rules, pool_state, start_at, day_length_secs, num_days, join_deadline_at, verify_window_secs, dispute_window_secs')
    .eq('onchain_address', challengeAddress)
    .maybeSingle();
  if (!c) return { ok: false, error: 'Challenge not found.' };
  const { data: m } = await admin.from('memberships').select('id').eq('challenge_id', c.id).eq('profile_id', profileId).maybeSingle();
  if (!m) return { ok: false, error: 'Only players of this challenge can check their day.' };

  const rules = (c.rules ?? {}) as { github?: GithubRulesDocument | null; leetcode?: LeetcodeRulesDocument | null };
  const providers = (['github', 'leetcode'] as const).filter((p) => Boolean(rules[p]));
  if (providers.length === 0) return { ok: false, error: "This challenge's rules list no provider to check." };

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
    return { ok: false, error: { not_started: "The challenge hasn't started yet: checks open on day 1.", over: 'Checking has closed: results are final.', cancelled: 'This challenge was cancelled.' }[slot.reason] };
  }

  const { data: last } = await admin.from('member_day_checks').select('checked_at').eq('membership_id', m.id).eq('day', slot.day).order('checked_at', { ascending: false }).limit(1).maybeSingle();
  const since = last ? now - secs(last.checked_at as string) : Number.POSITIVE_INFINITY;
  if (since < CHECK_COOLDOWN_SECS) {
    const wait = CHECK_COOLDOWN_SECS - since;
    return { ok: false, error: `Checked ${since}s ago. You can check again in ${wait}s.`, retryAfterSecs: wait };
  }

  const { data: run } = await admin.from('verification_runs').insert({ challenge_id: c.id, day: slot.day, triggered_by: 'manual' }).select('id').single();
  const args = { profileId, membershipId: m.id as string, day: slot.day, window: slot.window, runId: (run?.id as string | undefined) ?? null };
  const problems: string[] = [];
  const checked: Provider[] = [];
  for (const p of providers) {
    try {
      const problem = p === 'github' ? await checkGithub(admin, { ...args, doc: rules.github! }) : await checkLeetcode(admin, { ...args, doc: rules.leetcode! });
      if (problem) problems.push(problem);
      else checked.push(p);
    } catch (e) {
      console.error(`[check] ${p} failed:`, e);
      problems.push(`${p === 'github' ? 'GitHub' : 'LeetCode'} could not be reached. Try again in a minute.`);
    }
  }
  if (run) {
    await admin
      .from('verification_runs')
      .update({ status: problems.length === 0 ? 'succeeded' : checked.length ? 'partial' : 'failed', finished_at: new Date().toISOString(), checked_count: checked.length, error: problems.join(' ').slice(0, 2000) || null })
      .eq('id', run.id);
  }
  if (checked.length === 0) return { ok: false, error: problems.join(' ') };
  return { ok: true, day: slot.day, providers: checked };
}

// ---------------------------------------------------------------- reading logs

export interface DayLogItem {
  id: string;
  /** Commit SHA (short) or problem title. */
  label: string;
  /** Repository, for commits. */
  context: string;
  url: string;
  counted: boolean;
  /** Lines for commits; empty for LeetCode. */
  value: string;
  reason: string;
}

export interface DayLog {
  provider: Provider;
  day: number;
  /** Lines (GitHub) or new problems (LeetCode) toward the goal. */
  lines: number;
  goal: number;
  unit: string;
  outcome: 'met' | 'not_met' | 'unknown';
  /** The rules engine's outcome and confidence (null for checks made before Phase 27). */
  engineOutcome: ProviderOutcome | null;
  confidence: number | null;
  complete: boolean;
  pushes: number;
  hints: string[];
  notes: string[];
  checkedAt: string;
  commits: DayLogItem[];
}

/**
 * A member's checks for a day, read with the VIEWER's session: the database decides visibility
 * (the member's "share check details" and the creator's "players only" settings).
 */
export async function readDayLogs(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, membershipId: string, day: number): Promise<DayLog[]> {
  const { data: summaries } = await supabase
    .from('member_day_checks')
    .select('provider, day, lines, goal, outcome, confidence, breakdown, complete, pushes, hints, notes, checked_at')
    .eq('membership_id', membershipId)
    .eq('day', day);
  if (!summaries?.length) return [];
  const { data: rows } = await supabase
    .from('evidence')
    .select('provider, external_id, counted, reason, details, occurred_at')
    .eq('membership_id', membershipId)
    .eq('day', day)
    .order('counted', { ascending: false })
    .order('occurred_at', { ascending: true })
    .limit(400);
  return summaries
    .map((s): DayLog => {
      const provider = s.provider as Provider;
      return {
        provider,
        day: s.day as number,
        lines: s.lines as number,
        goal: s.goal as number,
        unit: provider === 'github' ? 'meaningful lines' : 'new problems',
        outcome: s.outcome as DayLog['outcome'],
        engineOutcome: ((s.breakdown as { engineOutcome?: ProviderOutcome } | null)?.engineOutcome ?? null),
        confidence: (s.confidence as number | null) ?? null,
        complete: s.complete as boolean,
        pushes: s.pushes as number,
        hints: (s.hints as string[]) ?? [],
        notes: (s.notes as string[]) ?? [],
        checkedAt: s.checked_at as string,
        commits: (rows ?? [])
          .filter((r) => r.provider === provider)
          .map((r) => {
            const d = (r.details ?? {}) as { repo?: string; lines?: number; title?: string; url?: string };
            const id = r.external_id as string;
            return provider === 'github'
              ? { id, label: id.slice(0, 8), context: d.repo ?? '', url: `https://github.com/${d.repo}/commit/${id}`, counted: r.counted as boolean, value: r.counted ? String(d.lines ?? 0) : '–', reason: r.reason as string }
              : { id, label: d.title ?? `#${id}`, context: '', url: d.url ?? `https://leetcode.com/submissions/detail/${id}/`, counted: r.counted as boolean, value: '', reason: r.reason as string };
          }),
      };
    })
    .sort((x, y) => x.provider.localeCompare(y.provider));
}
