// Provider adapters for the rules engine: what GitHub and LeetCode saw for a day, turned into
// outcome + progress + evidence + data quality (see ../rules-engine.ts for scoring and combining).
import type { ProviderEvaluation, ProviderQuality } from '../rules-engine.js';
import type { GithubDayResult } from './github.js';
import { evaluateLeetcodeDay, type LeetcodeDayResult, type LeetcodeRules, type LeetcodeSnapshotRecord } from './leetcode-day.js';

// ---------------------------------------------------------------- GitHub

/**
 * GitHub: met when the meaningful lines reach the goal. Otherwise not met, with lower quality when
 * GitHub didn't return everything (incomplete read, files without patches): an incomplete read can
 * still verify a day, but is never strong enough to fail one.
 */
export function githubEvaluation(day: GithubDayResult, read: { complete: boolean }, goal: number): ProviderEvaluation {
  return {
    provider: 'github',
    outcome: day.meetsThreshold ? 'met' : 'not_met',
    value: day.meaningfulLines,
    goal,
    quality: { complete: read.complete, gaps: day.missingPatches, coveragePct: 100 },
    evidence: [
      ...day.counted.map((c) => ({ id: c.sha, counted: true, code: 'counted', value: c.meaningfulLines, ref: c.repo })),
      ...day.skipped.filter((s) => s.reason !== 'outside-day').map((s) => ({ id: s.sha, counted: false, code: s.reason, ref: s.repo })),
    ],
  };
}

// ---------------------------------------------------------------- LeetCode

/** The final check also uses snapshots up to 45 minutes after the day ends (the next scheduled one). */
export const LEETCODE_FINAL_GRACE_SECS = 45 * 60;
/** A hidden profile must be seen at least twice, this far apart, before it can fail a day. */
export const LEETCODE_PRIVATE_CONFIRM_SECS = 25 * 60;

const at = (s: LeetcodeSnapshotRecord) => Date.parse(s.observedAt) / 1000;

/**
 * LeetCode quality, by what the outcome depends on:
 * - met: the anchor's age (an old anchor could let a solve from before the day count) and
 *   unreadable snapshots during the day (they could hide withdrawn evidence);
 * - not met: whether the latest snapshot reaches the end of the day (a solve after it is unseen);
 * - hidden history: confirmed only by two hidden snapshots 25+ minutes apart (one could be a glitch);
 *   a page without a solved count is a layout problem, not a hidden profile.
 */
export function leetcodeEvaluation(input: {
  anchor: LeetcodeSnapshotRecord | null;
  daySnapshots: LeetcodeSnapshotRecord[];
  window: { startSec: number; endSec: number };
  rules: LeetcodeRules;
  graceSecs?: number;
}): { result: LeetcodeDayResult; evaluation: ProviderEvaluation } {
  const result = evaluateLeetcodeDay(input);
  const limit = input.window.endSec + Math.max(0, input.graceSecs ?? 0);
  const inRange = input.daySnapshots.filter((s) => at(s) >= input.window.startSec && at(s) < limit).sort((a, b) => at(a) - at(b));
  const gaps = inRange.filter((s) => !s.readable).length;
  const latest = inRange.filter((s) => s.readable && s.snapshot).at(-1);

  let outcome: ProviderEvaluation['outcome'];
  let quality: ProviderQuality;
  if (result.status === 'private') {
    if (latest?.snapshot?.solved === null) {
      outcome = 'unknown';
      quality = { complete: false, gaps, coveragePct: 0 };
    } else {
      const tail: LeetcodeSnapshotRecord[] = [];
      for (const s of [...inRange].reverse()) {
        if (!s.readable) continue;
        if (s.snapshot && s.snapshot.solved !== null && !s.snapshot.hasRecentAcSection) tail.push(s);
        else break;
      }
      const confirmed = tail.length >= 2 && at(tail[0]!) - at(tail.at(-1)!) >= LEETCODE_PRIVATE_CONFIRM_SECS;
      outcome = 'failed';
      quality = { complete: true, gaps: 0, coveragePct: confirmed ? 100 : 70 };
    }
  } else if (result.status !== 'ok') {
    outcome = 'unknown';
    quality = { complete: false, gaps, coveragePct: 0 };
  } else if (result.meetsThreshold) {
    const anchorAge = input.window.startSec - at(input.anchor!);
    outcome = 'met';
    quality = { complete: true, gaps, coveragePct: anchorAge <= 3600 ? 100 : anchorAge <= 6 * 3600 ? 90 : 75 };
  } else {
    const latestAt = latest ? at(latest) : 0;
    outcome = 'not_met';
    quality = { complete: true, gaps: 0, coveragePct: latestAt >= input.window.endSec ? 100 : latestAt >= input.window.endSec - 1800 ? 85 : 50 };
  }

  const credited = new Set(result.newSolves.slice(0, result.creditedAtLevel).map((s) => s.submissionId));
  return {
    result,
    evaluation: {
      provider: 'leetcode',
      outcome,
      value: result.creditedAtLevel,
      goal: input.rules.minNewSolves,
      quality,
      evidence: [
        ...result.newSolves.map((s) => ({ id: s.submissionId, counted: credited.has(s.submissionId), code: credited.has(s.submissionId) ? 'new-solve' : 'not-credited', ...(credited.has(s.submissionId) ? { value: 1 } : {}), ref: s.title })),
        ...result.ignored.map((s) => ({ id: s.submissionId, counted: false, code: s.reason, ref: s.title })),
        ...result.withdrawn.map((s) => ({ id: s.submissionId, counted: false, code: 'withdrawn', ref: s.title })),
      ],
    },
  };
}
