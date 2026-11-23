// Group dashboard (pure): turns a challenge's members, day results and Shields into the board the
// app shows, at a given time. The server filters what a viewer may see before this runs; the
// browser re-runs it every second so "today" and the countdown move without refetching.

import { challengePhase, dayIndex, disputeEndTs, endTs, verifyEndTs, type ChallengePhase, type ChallengeTimes } from './program/lifecycle.js';

export type CellState = 'verified' | 'failed' | 'shielded' | 'indeterminate' | 'today' | 'pending' | 'upcoming';
export type MemberState = 'in' | 'out' | 'survived' | 'voided';
export type BoardVisibility = 'viewers' | 'participants';

export interface BoardCheck {
  day: number;
  counted: number;
  considered: number;
  providers: ('github' | 'leetcode')[];
  /** Latest day check: meaningful lines toward the goal (absent until someone checks). */
  lines?: number;
  goal?: number;
  outcome?: 'met' | 'not_met' | 'unknown';
  /** Latest day check per provider (GitHub lines, LeetCode new problems). */
  progress?: { provider: 'github' | 'leetcode'; value: number; goal: number; outcome: 'met' | 'not_met' | 'unknown' }[];
}

export interface BoardMemberInput {
  membershipId: string;
  publicId: string;
  name: string;
  /** Mirrored on-chain outcome once finalized; 'active' until then. */
  status: 'active' | 'survived' | 'failed' | 'voided';
  isViewer: boolean;
  isCreator: boolean;
  shareChecks: boolean;
  results: { day: number; result: 'verified' | 'failed' | 'indeterminate' }[];
  shieldDays: number[];
  /** Absent when the member keeps their check details private (and isn't the viewer). */
  checks?: BoardCheck[];
}

export interface BoardInput {
  times: ChallengeTimes;
  minParticipants: number;
  maxParticipants: number;
  /** Base units, as strings (u64). */
  poolTotal: string;
  boardVisibility: BoardVisibility;
  /** False when the owner limited the board to players and the viewer isn't one: no members sent. */
  membersVisible: boolean;
  memberCount: number;
  members: BoardMemberInput[];
  /** What a day needs (from the rules): lets "done today" count goals already met at the latest check. */
  goal?: { providers: ('github' | 'leetcode')[]; rule: 'any' | 'all' };
}

/** A member's latest check for `day` meets the challenge's goal (ANY/ALL of its providers). */
export function goalMetAtCheck(m: Pick<BoardMemberInput, 'checks'>, day: number, goal: BoardInput['goal']): boolean {
  const progress = m.checks?.find((c) => c.day === day)?.progress;
  if (!goal || !progress?.length || goal.providers.length === 0) return false;
  const met = (p: 'github' | 'leetcode') => progress.some((x) => x.provider === p && x.outcome === 'met');
  return goal.rule === 'all' ? goal.providers.every(met) : goal.providers.some(met);
}

export interface BoardMember extends Omit<BoardMemberInput, 'results' | 'shieldDays'> {
  state: MemberState;
  cells: CellState[];
  /** The current day's cell, or null outside the active period. */
  today: CellState | null;
  /** Today's goal is met: recorded, shielded, or met at the latest check. */
  doneToday: boolean;
  verifiedDays: number;
  shieldsUsed: number;
}

export interface Countdown {
  label: string;
  targetTs: number;
}

export interface Board {
  phase: ChallengePhase;
  statusLabel: string;
  /** 0-based current day, or null outside the active period. */
  day: number | null;
  numDays: number;
  countdown: Countdown | null;
  members: BoardMember[];
  memberCount: number;
  stillIn: number;
  out: number;
  survived: number;
  /** Members who have today's day verified (or Shielded), during the active period. */
  doneToday: number;
}

export const PHASE_LABELS: Record<ChallengePhase, string> = {
  joining: 'Joining open',
  starting: 'Starting soon',
  active: 'Running',
  verifying: 'Final checks',
  disputeWindow: 'Dispute window',
  awaitingSettlement: 'Ready to settle',
  settled: 'Settled',
  cancelled: 'Cancelled',
};

export function cellState(member: Pick<BoardMemberInput, 'results' | 'shieldDays'>, d: number, current: number | null, ended: boolean): CellState {
  const r = member.results.find((x) => x.day === d)?.result;
  if (r === 'verified') return 'verified';
  if (r === 'indeterminate') return 'indeterminate';
  if (r === 'failed') return member.shieldDays.includes(d) ? 'shielded' : 'failed';
  if (member.shieldDays.includes(d)) return 'shielded';
  if (ended || (current !== null && d < current)) return 'pending'; // day over, result not recorded yet
  if (current === d) return 'today';
  return 'upcoming';
}

export function memberState(m: BoardMemberInput): MemberState {
  if (m.status === 'survived') return 'survived';
  if (m.status === 'failed') return 'out';
  if (m.status === 'voided') return 'voided';
  return m.results.some((r) => r.result === 'failed' && !m.shieldDays.includes(r.day)) ? 'out' : 'in';
}

export function countdownFor(phase: ChallengePhase, t: ChallengeTimes, now: number): Countdown | null {
  switch (phase) {
    case 'joining':
      return { label: 'Joining closes', targetTs: t.joinDeadlineTs };
    case 'starting':
      return { label: 'Starts', targetTs: t.startTs };
    case 'active': {
      const d = dayIndex(t, now)!;
      return { label: `Day ${d + 1} ends`, targetTs: t.startTs + (d + 1) * t.dayLengthSecs };
    }
    case 'verifying':
      return { label: 'Final checks close', targetTs: verifyEndTs(t) };
    case 'disputeWindow':
      return { label: 'Disputes close', targetTs: disputeEndTs(t) };
    default:
      return null;
  }
}

const STATE_ORDER: Record<MemberState, number> = { survived: 0, in: 1, voided: 2, out: 3 };

export function buildBoard(input: BoardInput, now: number): Board {
  const t = input.times;
  const phase = challengePhase(t, now);
  const day = dayIndex(t, now);
  const ended = now >= endTs(t);

  const members = input.members
    .map((m): BoardMember => {
      const cells = Array.from({ length: t.numDays }, (_, d) => cellState(m, d, day, ended));
      const { results: _r, shieldDays, ...rest } = m;
      return {
        ...rest,
        // A cancelled challenge refunds everyone still in it.
        state: t.state === 'cancelled' && m.status === 'active' ? 'voided' : memberState(m),
        cells,
        today: day === null ? null : cells[day]!,
        doneToday: day !== null && (cells[day] === 'verified' || cells[day] === 'shielded' || goalMetAtCheck(m, day, input.goal)),
        verifiedDays: cells.filter((c) => c === 'verified').length,
        shieldsUsed: shieldDays.length,
      };
    })
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || b.verifiedDays - a.verifiedDays || a.name.localeCompare(b.name));

  return {
    phase,
    statusLabel: PHASE_LABELS[phase],
    day,
    numDays: t.numDays,
    countdown: countdownFor(phase, t, now),
    members,
    memberCount: input.memberCount,
    stillIn: members.filter((m) => m.state === 'in').length,
    out: members.filter((m) => m.state === 'out').length,
    survived: members.filter((m) => m.state === 'survived').length,
    // Recorded results, plus goals already met at the latest check (a preview until the day is recorded).
    doneToday: day === null ? 0 : members.filter((m) => m.doneToday).length,
  };
}

/** "2d 4h", "3h 05m", "4m 09s", "0s" */
export function formatCountdown(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(r).padStart(2, '0')}s`;
  return `${r}s`;
}

/**
 * Which day a member can check now: the running day, or the last day while its final checks are
 * still open. Before the start and once results are final there is nothing to check.
 */
export function checkableDay(t: ChallengeTimes, now: number): { ok: true; day: number; window: { startSec: number; endSec: number } } | { ok: false; reason: 'not_started' | 'over' | 'cancelled' } {
  if (t.state === 'cancelled') return { ok: false, reason: 'cancelled' };
  if (now < t.startTs) return { ok: false, reason: 'not_started' };
  const end = endTs(t);
  let day: number;
  if (now < end) day = Math.floor((now - t.startTs) / t.dayLengthSecs);
  else if (now < verifyEndTs(t) && t.state !== 'settled') day = t.numDays - 1;
  else return { ok: false, reason: 'over' };
  const startSec = t.startTs + day * t.dayLengthSecs;
  return { ok: true, day, window: { startSec, endSec: startSec + t.dayLengthSecs } };
}
