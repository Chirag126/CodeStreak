// LeetCode daily activity rules (pure, isomorphic).
//
// LeetCode has no activity feed and no per-submission API we can trust, so a day is judged by
// comparing snapshots of the public profile (Firecrawl, live, parsed deterministically):
//   anchor   = the last snapshot taken AT OR BEFORE the day started ("midnight anchor")
//   latest   = the newest snapshot inside the day
// A day's credit is NEW problems solved:
//   1. the solved count went up (re-solving an old problem never raises it), AND
//   2. a new Accepted submission appeared (submission ids only grow) for a problem that was not
//      in the anchor's recent list; credit = min(solved increase, distinct new titles).
// Difficulty comes from the per-difficulty solved counts (Easy/Medium/Hard), which a user can't fake.
// Withdrawn evidence: a new solve seen earlier in the day that later vanishes (deleted or hidden),
// or a solved count that goes down, is flagged and never credited.
// Outcomes: unreadable page or no anchor -> indeterminate (never costs a stake); a private
// profile (history hidden) -> failed (keeping it public is a rule of the challenge).
import type { LeetcodeSnapshot, RecentAccepted } from './leetcode.js';

export type LeetcodeDifficulty = 'any' | 'medium' | 'hard';

export interface LeetcodeRules {
  /** New problems to solve per day. */
  minNewSolves: number;
  minDifficulty: LeetcodeDifficulty;
}

export const DEFAULT_LEETCODE_RULES: LeetcodeRules = { minNewSolves: 1, minDifficulty: 'any' };
export const LEETCODE_OPTION_LIMITS = { maxNewSolves: 5 } as const;

export interface LeetcodeSnapshotRecord {
  observedAt: string;
  /** False when the page couldn't be read (Firecrawl/LeetCode error). */
  readable: boolean;
  snapshot: LeetcodeSnapshot | null;
}

export type LeetcodeDayStatus = 'ok' | 'unreadable' | 'no_anchor' | 'private' | 'no_data';

export interface LeetcodeDayResult {
  status: LeetcodeDayStatus;
  credited: number;
  /** Credited solves at or above the minimum difficulty. */
  creditedAtLevel: number;
  meetsThreshold: boolean;
  solvedDelta: number | null;
  levels: { easy: number | null; medium: number | null; hard: number | null };
  newSolves: { submissionId: string; title: string }[];
  ignored: { submissionId: string; title: string; reason: 'already-solved-recently' | 'before-the-day' }[];
  withdrawn: { submissionId: string; title: string }[];
  countDecreased: boolean;
}

/** Submission history hidden (or the page layout changed): no list or no solved count. */
export function isPrivateSnapshot(s: LeetcodeSnapshot | null): boolean {
  return !s || !s.hasRecentAcSection || s.solved === null;
}

const big = (id: string) => BigInt(id);
const SHORT_AGE = 6 * 3600; // ages up to a few hours are precise enough to place a solve before the day

export function evaluateLeetcodeDay(input: {
  anchor: LeetcodeSnapshotRecord | null;
  /** Snapshots taken inside the day, any order. */
  daySnapshots: LeetcodeSnapshotRecord[];
  window: { startSec: number; endSec: number };
  rules?: LeetcodeRules;
}): LeetcodeDayResult {
  const rules = input.rules ?? DEFAULT_LEETCODE_RULES;
  const empty = (status: LeetcodeDayStatus): LeetcodeDayResult => ({
    status,
    credited: 0,
    creditedAtLevel: 0,
    meetsThreshold: false,
    solvedDelta: null,
    levels: { easy: null, medium: null, hard: null },
    newSolves: [],
    ignored: [],
    withdrawn: [],
    countDecreased: false,
  });
  const inDay = input.daySnapshots
    .filter((s) => {
      const t = Date.parse(s.observedAt) / 1000;
      return t >= input.window.startSec && t < input.window.endSec;
    })
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const latest = inDay.at(-1);
  if (!latest) return empty('no_data');
  if (!latest.readable || !latest.snapshot) return empty('unreadable');
  if (isPrivateSnapshot(latest.snapshot)) return empty('private');
  const anchor = input.anchor;
  if (!anchor || !anchor.readable || isPrivateSnapshot(anchor.snapshot) || Date.parse(anchor.observedAt) / 1000 > input.window.startSec) return empty('no_anchor');

  const a = anchor.snapshot!;
  const l = latest.snapshot;
  const anchorIds = new Set(a.recentAccepted.map((r) => r.submissionId));
  const anchorTitles = new Set(a.recentAccepted.map((r) => r.title.toLowerCase()));
  const anchorMax = a.recentAccepted.reduce((m, r) => (big(r.submissionId) > m ? big(r.submissionId) : m), 0n);
  const latestObserved = Date.parse(latest.observedAt) / 1000;

  const result = empty('ok');
  const titles = new Set<string>();
  for (const r of l.recentAccepted) {
    if (anchorIds.has(r.submissionId) || big(r.submissionId) <= anchorMax) continue;
    if (anchorTitles.has(r.title.toLowerCase())) {
      result.ignored.push({ submissionId: r.submissionId, title: r.title, reason: 'already-solved-recently' });
      continue;
    }
    if (r.approxAgeSeconds !== null && r.approxAgeSeconds <= SHORT_AGE && latestObserved - r.approxAgeSeconds < input.window.startSec) {
      result.ignored.push({ submissionId: r.submissionId, title: r.title, reason: 'before-the-day' });
      continue;
    }
    result.newSolves.push({ submissionId: r.submissionId, title: r.title });
    titles.add(r.title.toLowerCase());
  }

  // Withdrawn: a new solve seen earlier today that the latest list should still show, but doesn't.
  const latestIds = new Set(l.recentAccepted.map((r) => r.submissionId));
  const latestMin = l.recentAccepted.reduce<bigint | null>((m, r) => (m === null || big(r.submissionId) < m ? big(r.submissionId) : m), null);
  const seenWithdrawn = new Set<string>();
  for (const s of inDay.slice(0, -1)) {
    if (!s.readable || !s.snapshot || isPrivateSnapshot(s.snapshot)) continue;
    if (s.snapshot.solved !== null && l.solved !== null && s.snapshot.solved > l.solved) result.countDecreased = true;
    for (const r of s.snapshot.recentAccepted as RecentAccepted[]) {
      const id = big(r.submissionId);
      if (id <= anchorMax || latestIds.has(r.submissionId) || seenWithdrawn.has(r.submissionId)) continue;
      if (latestMin !== null && id > latestMin) {
        seenWithdrawn.add(r.submissionId);
        result.withdrawn.push({ submissionId: r.submissionId, title: r.title });
      }
    }
  }

  result.solvedDelta = a.solved !== null && l.solved !== null ? l.solved - a.solved : null;
  const delta = (x: number | null | undefined, y: number | null | undefined) => (x != null && y != null ? y - x : null);
  result.levels = { easy: delta(a.easy, l.easy), medium: delta(a.medium, l.medium), hard: delta(a.hard, l.hard) };
  result.credited = result.countDecreased ? 0 : Math.max(0, Math.min(result.solvedDelta ?? 0, titles.size));

  if (rules.minDifficulty === 'any') result.creditedAtLevel = result.credited;
  else {
    const { medium, hard } = result.levels;
    if (hard === null || (rules.minDifficulty === 'medium' && medium === null)) return { ...result, status: 'unreadable', creditedAtLevel: 0 };
    const eligible = rules.minDifficulty === 'hard' ? Math.max(0, hard) : Math.max(0, hard) + Math.max(0, medium ?? 0);
    result.creditedAtLevel = Math.min(result.credited, eligible);
  }
  result.meetsThreshold = result.creditedAtLevel >= rules.minNewSolves;
  return result;
}

export type LeetcodeDayOutcome = 'verified' | 'failed' | 'indeterminate';

export function leetcodeDayOutcome(r: LeetcodeDayResult): LeetcodeDayOutcome {
  if (r.meetsThreshold) return 'verified';
  if (r.status === 'unreadable' || r.status === 'no_anchor' || r.status === 'no_data') return 'indeterminate';
  return 'failed';
}

export interface LeetcodeRulesDocument {
  minNewSolves?: number;
  /** Older documents. */
  minAcceptedPerDay?: number;
  minDifficulty?: LeetcodeDifficulty;
}

export function leetcodeRulesFromDocument(doc: LeetcodeRulesDocument | null | undefined): LeetcodeRules {
  const n = Math.trunc(doc?.minNewSolves ?? doc?.minAcceptedPerDay ?? 1);
  const level = doc?.minDifficulty;
  return {
    minNewSolves: Math.min(Math.max(1, n), LEETCODE_OPTION_LIMITS.maxNewSolves),
    minDifficulty: level === 'medium' || level === 'hard' ? level : 'any',
  };
}

/** Plain-language explanations of a LeetCode day (shared by the app and tools). */
export function explainLeetcodeDay(r: LeetcodeDayResult, rules: LeetcodeRules): string[] {
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const hints: string[] = [];
  const level = rules.minDifficulty === 'any' ? '' : rules.minDifficulty === 'medium' ? ' (Medium or Hard)' : ' (Hard)';
  switch (r.status) {
    case 'no_data':
      return ['No snapshot of your LeetCode profile was taken today yet.'];
    case 'unreadable':
      return ['LeetCode could not be read, so this day counts as "couldn’t be checked": it never costs a stake.'];
    case 'no_anchor':
      return ['There is no snapshot from before the day started to compare with, so this day counts as "couldn’t be checked": it never costs a stake.'];
    case 'private':
      return ['Your LeetCode submission history is hidden. Make it public (LeetCode privacy settings), or the day can’t count.'];
  }
  if (r.meetsThreshold) hints.push(`Goal reached: ${n(r.creditedAtLevel, 'new problem', 'new problems')} solved today${level}.`);
  const resolves = r.ignored.filter((i) => i.reason === 'already-solved-recently').length;
  if (resolves) hints.push(`${n(resolves, 'accepted submission was a re-solve', 'accepted submissions were re-solves')} of a problem you had already solved, so ${resolves === 1 ? 'it doesn’t' : 'they don’t'} count.`);
  const before = r.ignored.filter((i) => i.reason === 'before-the-day').length;
  if (before) hints.push(`${n(before, 'solve was', 'solves were')} made before the day started.`);
  if (r.solvedDelta === 0 && r.newSolves.length > 0) hints.push('Your solved count did not go up today, so new submissions were re-solves of older problems.');
  if (r.withdrawn.length) hints.push(`${n(r.withdrawn.length, 'solve seen earlier today has', 'solves seen earlier today have')} disappeared from your profile, so ${r.withdrawn.length === 1 ? 'it doesn’t' : 'they don’t'} count.`);
  if (r.countDecreased) hints.push('Your solved count went down during the day, so today’s solves can’t be credited.');
  if (!r.meetsThreshold) {
    const missing = rules.minNewSolves - r.creditedAtLevel;
    hints.push(`${n(missing, 'more new problem', 'more new problems')}${level} needed today (${r.creditedAtLevel} of ${rules.minNewSolves}).`);
  }
  return hints;
}
