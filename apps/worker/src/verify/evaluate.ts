// The final evaluation of one player's day, with the same code the "Check now" preview uses
// (Phase 24 GitHub, Phase 26 LeetCode, Phase 27 rules engine). Read-only: it never writes results.
import { type ProviderEvaluation } from '@codestreak/shared';
import {
  choiceForDay,
  collectGithubCommits,
  createGithubGet,
  evaluateGithubDay,
  githubEvaluation,
  githubRulesFromDocument,
  LEETCODE_FINAL_GRACE_SECS,
  leetcodeEvaluation,
  leetcodeRulesFromDocument,
  readLeetcodeSnapshot,
  repoChoiceFromRow,
  repoModeOf,
  SKIP_REASON_TEXT,
  snapshotRecordFromRow,
  type GithubRulesDocument,
  type LeetcodeRulesDocument,
} from '@codestreak/shared/verification';
import type { Db } from './db.js';

export interface RulesDocument {
  providers?: string[];
  providerRule?: 'any' | 'all';
  github?: GithubRulesDocument | null;
  leetcode?: LeetcodeRulesDocument | null;
}

/** One row for public.evidence (through save_day_result). */
export interface EvidenceRow {
  provider: 'github' | 'leetcode';
  kind: 'commit' | 'submission';
  external_id: string;
  occurred_at?: string;
  diff_hash?: string | null;
  counted: boolean;
  reason: string;
  details: Record<string, unknown>;
}

export interface DayEvaluation {
  providers: ProviderEvaluation[];
  evidence: EvidenceRow[];
  /** A provider couldn't be reached (network/rate limit): better to try again than to record "unknown". */
  transientFailure: string | null;
}

export interface EvaluateDeps {
  db: Db;
  githubToken?: string;
  firecrawlApiKey?: string;
  fetchImpl?: typeof fetch;
  /** Per-run cache: a GitHub account's day is fetched once even if it is in several challenges. */
  githubCache: Map<string, Promise<Awaited<ReturnType<typeof collectGithubCommits>>>>;
  log: (m: string) => void;
}

const LEETCODE_REASON: Record<string, string> = {
  'new-solve': 'New problem solved.',
  'not-credited': "Not credited: your solved count didn't rise by this much.",
  'already-solved-recently': 'A re-solve of a problem you had already solved.',
  'before-the-day': 'Solved before the day started.',
  'after-the-day': 'Solved after the day ended (counts for the next day).',
  withdrawn: 'Seen earlier, then disappeared from your profile.',
};

const unknown = (provider: 'github' | 'leetcode', goal: number): ProviderEvaluation => ({
  provider,
  outcome: 'unknown',
  value: 0,
  goal,
  quality: { complete: false, gaps: 0, coveragePct: 0 },
  evidence: [],
});

export async function evaluateMemberDay(
  deps: EvaluateDeps,
  input: { challengeId: string; profileId: string; membershipId: string; day: number; window: { startSec: number; endSec: number }; rules: RulesDocument },
): Promise<DayEvaluation> {
  const out: DayEvaluation = { providers: [], evidence: [], transientFailure: null };
  const accounts = await deps.db.select<{ provider: string; provider_user_id: string }>(
    'linked_accounts',
    `select=provider,provider_user_id&profile_id=eq.${input.profileId}`,
  );
  const linked = (p: string) => accounts.find((a) => a.provider === p)?.provider_user_id;

  // ---- GitHub
  if (input.rules.github) {
    // Individual repository mode: the player's repository in force when this day started.
    const individual = repoModeOf(input.rules.github) === 'individual';
    const choice = individual
      ? choiceForDay(
          (
            await deps.db.select<{ repo_id: number; repo_owner_id: number; full_name: string; effective_from: string }>(
              'challenge_repo_choices',
              `select=repo_id,repo_owner_id,full_name,effective_from&challenge_id=eq.${input.challengeId}&profile_id=eq.${input.profileId}&order=effective_from.asc&limit=100`,
            )
          ).map(repoChoiceFromRow),
          input.window.startSec,
        )
      : null;
    const rules = githubRulesFromDocument(input.rules.github, choice);
    const githubId = linked('github');
    if (!githubId) out.providers.push(unknown('github', rules.minMeaningfulLines));
    else {
      try {
        const cacheKey = `${githubId}:${input.window.startSec}:${rules.repoScope ?? 'own'}:${(rules.repos ?? []).join(',')}`;
        let pending = deps.githubCache.get(cacheKey);
        if (!pending) {
          pending = collectGithubCommits({ get: createGithubGet(deps.githubToken), githubId: Number(githubId), window: input.window, repoIds: rules.repos ?? null, memberRepo: rules.repoScope === 'member' });
          deps.githubCache.set(cacheKey, pending);
        }
        const data = await pending;
        // A commit (or the same change) already counted on another day never counts again.
        const earlier = await deps.db.select<{ external_id: string; diff_hash: string | null; counted: boolean }>(
          'evidence',
          `select=external_id,diff_hash,counted&membership_id=eq.${input.membershipId}&provider=eq.github&day=neq.${input.day}&limit=5000`,
        );
        const earlierShas = new Set(earlier.map((e) => e.external_id));
        const seen = {
          shas: new Set(earlierShas), // updated in place by evaluateGithubDay
          diffHashes: new Set(earlier.filter((e) => e.counted && e.diff_hash).map((e) => e.diff_hash as string)),
        };
        const day = evaluateGithubDay({ commits: data.commits, userGithubId: Number(githubId), window: input.window, rules, seen });
        const evaluation = githubEvaluation(day, data, rules.minMeaningfulLines);
        out.providers.push(evaluation);
        const pushedAt = new Map(data.commits.map((c) => [c.sha, c.pushedAt]));
        for (const c of day.counted) {
          out.evidence.push({ provider: 'github', kind: 'commit', external_id: c.sha, occurred_at: pushedAt.get(c.sha), diff_hash: c.diffHash, counted: true, reason: 'Counted.', details: { repo: c.repo, lines: c.meaningfulLines, code: 'counted' } });
        }
        for (const s of day.skipped) {
          if (s.reason === 'outside-day' || earlierShas.has(s.sha)) continue; // listed on its own day
          out.evidence.push({ provider: 'github', kind: 'commit', external_id: s.sha, occurred_at: pushedAt.get(s.sha), counted: false, reason: SKIP_REASON_TEXT[s.reason], details: { repo: s.repo, lines: 0, code: s.reason } });
        }
      } catch (e) {
        out.transientFailure = `GitHub: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
        out.providers.push(unknown('github', rules.minMeaningfulLines));
      }
    }
  }

  // ---- LeetCode
  if (input.rules.leetcode) {
    const rules = leetcodeRulesFromDocument(input.rules.leetcode);
    const handle = linked('leetcode');
    if (!handle) out.providers.push(unknown('leetcode', rules.minNewSolves));
    else {
      try {
        const evaluation = await leetcodeDay(deps, input, handle, rules);
        out.providers.push(evaluation);
        for (const e of evaluation.evidence) {
          out.evidence.push({
            provider: 'leetcode',
            kind: 'submission',
            external_id: e.id,
            counted: e.counted,
            reason: LEETCODE_REASON[e.code] ?? e.code,
            details: { title: e.ref ?? null, url: `https://leetcode.com/submissions/detail/${e.id}/`, code: e.code },
          });
        }
      } catch (e) {
        out.transientFailure = `LeetCode: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
        out.providers.push(unknown('leetcode', rules.minNewSolves));
      }
    }
  }
  return out;
}

type SnapshotRow = Parameters<typeof snapshotRecordFromRow>[0];

/** The day's LeetCode evaluation from stored snapshots, taking a final one after the day if needed. */
async function leetcodeDay(
  deps: EvaluateDeps,
  input: { profileId: string; window: { startSec: number; endSec: number } },
  handle: string,
  rules: ReturnType<typeof leetcodeRulesFromDocument>,
): Promise<ProviderEvaluation> {
  const cols = 'observed_at,handle,readable,solved,easy,medium,hard,has_history,recent,error';
  const iso = (s: number) => new Date(s * 1000).toISOString();
  const base = `select=${cols}&profile_id=eq.${input.profileId}&handle=eq.${encodeURIComponent(handle)}`;
  const daySnapshots = () =>
    deps.db.select<SnapshotRow>(
      'leetcode_snapshots',
      `${base}&observed_at=gte.${iso(input.window.startSec)}&observed_at=lt.${iso(input.window.endSec + LEETCODE_FINAL_GRACE_SECS)}&order=observed_at.asc&limit=200`,
    );
  let rows = await daySnapshots();
  // The final read must see the profile after the day ended (a solve in the last minutes).
  if (!rows.some((r) => r.readable && Date.parse(r.observed_at) / 1000 >= input.window.endSec) && deps.firecrawlApiKey) {
    await deps.db.insert('leetcode_snapshots', await readLeetcodeSnapshot(deps.firecrawlApiKey, input.profileId, handle, 'scheduled', deps.fetchImpl));
    rows = await daySnapshots();
  }
  // The anchor: the newest readable snapshot of this handle at or before the day started.
  const [anchorRow] = await deps.db.select<SnapshotRow>('leetcode_snapshots', `${base}&readable=is.true&observed_at=lte.${iso(input.window.startSec)}&order=observed_at.desc&limit=1`);
  return leetcodeEvaluation({
    anchor: anchorRow ? snapshotRecordFromRow(anchorRow) : null,
    daySnapshots: rows.map((r) => snapshotRecordFromRow(r)),
    window: input.window,
    rules,
    graceSecs: LEETCODE_FINAL_GRACE_SECS,
  }).evaluation;
}
