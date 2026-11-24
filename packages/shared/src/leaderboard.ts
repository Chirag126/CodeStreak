// Phase 36 - leaderboards, computed from recorded (on-chain) results only. Pure, so every board is
// checked against hand-computed fixtures. Streaks and success rate use the same rules as Insights
// (computeInsights): a Shield keeps a missed day; success = verified ÷ (verified + uncovered failed).
import { computeInsights, isoWeekStart, type InsightDay } from './insights.js';
import type { Token } from './dashboard.js';

export type BoardKind = 'weekly' | 'streak' | 'consistent' | 'earners';

export const BOARD_LABELS: Record<BoardKind, { title: string; unit: string; rule: string }> = {
  weekly: { title: 'This week', unit: 'days', rule: 'Days kept (verified, or covered by a Shield) whose window started this ISO week (Monday 00:00 UTC).' },
  streak: { title: 'Longest streak', unit: 'days', rule: 'Most consecutive kept days across all challenges, in time order (a Shield keeps a missed day).' },
  consistent: { title: 'Most consistent', unit: '%', rule: 'Verified ÷ (verified + failed), with at least 3 decided days. Ties: more decided days first.' },
  earners: { title: 'Top earners', unit: '', rule: 'Rewards above the stake, from payouts made after settlement (survivors only). Per token.' },
};

/** Minimum decided days to appear on "Most consistent" (one lucky day is not consistency). */
export const CONSISTENCY_MIN_DAYS = 3;

export interface LeaderMembership {
  profileId: string;
  username: string | null;
  displayName: string | null;
  challengeId: string;
  token: Token;
  startTs: number;
  dayLengthSecs: number;
  status: 'active' | 'survived' | 'failed' | 'voided';
  deposited: bigint;
  /** Paid to the player after settlement (null until paid). */
  payout: bigint | null;
  /** Recorded on-chain results by day. */
  results: { day: number; result: 'verified' | 'failed' | 'indeterminate' }[];
  shieldDays: number[];
}

export interface RankedEntry {
  rank: number;
  profileId: string;
  name: string;
  username: string | null;
  /** Numeric score used for ranking (days, percent, base units). */
  score: number | bigint;
  /** Secondary figure shown under the score (e.g. decided days). */
  detail: string;
}

const nameOf = (m: Pick<LeaderMembership, 'username' | 'displayName'>) => m.displayName?.trim() || (m.username ? `@${m.username}` : 'Anonymous');

/** Competition ranking (1, 2, 2, 4): equal scores share a rank; order inside a tie is by name. */
function rank<T extends { score: number | bigint; tie?: number; name: string; profileId: string }>(rows: T[], limit: number): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => {
    if (a.score !== b.score) return a.score > b.score ? -1 : 1;
    if ((a.tie ?? 0) !== (b.tie ?? 0)) return (b.tie ?? 0) - (a.tie ?? 0);
    return a.name.localeCompare(b.name) || a.profileId.localeCompare(b.profileId);
  });
  const out: (T & { rank: number })[] = [];
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    const tied = prev && prev.score === r.score && (prev.tie ?? 0) === (r.tie ?? 0);
    out.push({ ...r, rank: tied ? out[i - 1]!.rank : i + 1 });
  });
  return out.slice(0, limit);
}

function daysOf(ms: LeaderMembership[]): Map<string, { m: LeaderMembership; days: InsightDay[] }> {
  const by = new Map<string, { m: LeaderMembership; days: InsightDay[] }>();
  for (const m of ms) {
    const e = by.get(m.profileId) ?? { m, days: [] };
    for (const r of m.results) {
      e.days.push({ challenge: m.challengeId, startedAt: m.startTs + r.day * m.dayLengthSecs, result: r.result, shielded: m.shieldDays.includes(r.day) });
    }
    by.set(m.profileId, e);
  }
  return by;
}

export function buildLeaderboard(kind: BoardKind, ms: LeaderMembership[], now: number, opts: { token?: Token; limit?: number } = {}): RankedEntry[] {
  const limit = opts.limit ?? 50;
  const people = daysOf(ms);
  const rows: { profileId: string; name: string; username: string | null; score: number | bigint; tie?: number; detail: string }[] = [];

  if (kind === 'earners') {
    const token = opts.token ?? 'usdc';
    const earned = new Map<string, { m: LeaderMembership; amount: bigint; wins: number }>();
    for (const m of ms) {
      if (m.token !== token || m.status !== 'survived' || m.payout === null) continue;
      const e = earned.get(m.profileId) ?? { m, amount: 0n, wins: 0 };
      e.amount += m.payout > m.deposited ? m.payout - m.deposited : 0n;
      e.wins++;
      earned.set(m.profileId, e);
    }
    for (const [id, e] of earned) {
      if (e.amount <= 0n) continue;
      rows.push({ profileId: id, name: nameOf(e.m), username: e.m.username, score: e.amount, tie: e.wins, detail: `${e.wins} challenge${e.wins === 1 ? '' : 's'} won` });
    }
    return rank(rows, limit);
  }

  const weekStart = isoWeekStart(now);
  for (const [id, { m, days }] of people) {
    if (!days.length) continue;
    const ins = computeInsights(days, [], now, 1);
    if (kind === 'weekly') {
      const kept = days.filter((d) => d.startedAt >= weekStart && d.startedAt <= now && (d.result === 'verified' || d.shielded)).length;
      if (kept > 0) rows.push({ profileId: id, name: nameOf(m), username: m.username, score: kept, detail: `${kept} day${kept === 1 ? '' : 's'} kept this week` });
    } else if (kind === 'streak') {
      if (ins.longestStreak > 0) rows.push({ profileId: id, name: nameOf(m), username: m.username, score: ins.longestStreak, tie: ins.currentStreak, detail: `current ${ins.currentStreak}` });
    } else {
      const decided = ins.verified + ins.failed;
      if (decided >= CONSISTENCY_MIN_DAYS && ins.successRate !== null) {
        rows.push({ profileId: id, name: nameOf(m), username: m.username, score: ins.successRate, tie: decided, detail: `${ins.verified} of ${decided} days` });
      }
    }
  }
  return rank(rows, limit);
}

/** Rank movement since the previous render: positive = moved up. New entries are null. */
export function rankChanges(prev: Map<string, number>, next: Pick<RankedEntry, 'profileId' | 'rank'>[]): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const e of next) {
    const before = prev.get(e.profileId);
    out.set(e.profileId, before === undefined ? null : before - e.rank);
  }
  return out;
}
