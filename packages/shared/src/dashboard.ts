// Phase 35 - the developer dashboard, as pure functions over the viewer's own records.
// Every time is unix seconds (UTC). Amounts are base units (bigint). Nothing here estimates what
// it can read: today's status comes from the recorded result, a Shield or the latest "Check now";
// the potential reward is computeSettlement() with the players still in (labelled as an estimate).
import { computeSettlement } from './payout.js';
import { currentDeadline, warningLeadSecs } from './deadline.js';

export type Token = 'sol' | 'usdc';
export const TOKEN_DECIMALS: Record<Token, number> = { sol: 9, usdc: 6 };

export interface DashChallengeInput {
  id: string;
  title: string;
  address: string | null;
  token: Token;
  buyIn: bigint;
  poolState: 'open' | 'cancelled' | 'settled';
  startTs: number;
  dayLengthSecs: number;
  numDays: number;
  joinDeadlineTs: number;
  participantCount: number;
  totalSponsor: bigint;
  totalShield: bigint;
  /** Players with no uncovered failed day so far (the viewer included when still in). */
  stillIn: number;
}

export interface DashMembershipInput {
  id: string;
  status: 'active' | 'survived' | 'failed' | 'voided';
  deposited: bigint;
  challenge: DashChallengeInput;
  /** Recorded (on-chain) results by day. */
  results: Record<number, 'verified' | 'failed' | 'indeterminate'>;
  shieldDays: number[];
  /** Latest "Check now" outcome per day (any provider met → met). */
  checks: Record<number, 'met' | 'not_met' | 'unknown'>;
}

export type TodayStatus =
  | 'verified' // recorded on-chain
  | 'failed' // recorded on-chain
  | 'undecided' // recorded as indeterminate
  | 'shielded' // a Shield covers it
  | 'on_track' // latest check met the goal (not recorded yet)
  | 'behind' // latest check below the goal
  | 'unknown' // latest check had incomplete data
  | 'not_checked' // nothing yet today
  | 'not_started' // the challenge hasn't started
  | 'out'; // an earlier uncovered failure ended the streak

export const TODAY_LABELS: Record<TodayStatus, string> = {
  verified: 'Verified on-chain',
  failed: 'Failed (recorded)',
  undecided: 'Undecided (recorded)',
  shielded: 'Covered by a Shield',
  on_track: 'Goal met, waiting to be recorded',
  behind: 'Below the goal so far',
  unknown: 'Data incomplete so far',
  not_checked: 'Not checked yet today',
  not_started: 'Starts soon',
  out: 'Streak lost in this challenge',
};

export interface ActiveChallenge {
  membershipId: string;
  title: string;
  address: string | null;
  token: Token;
  stake: bigint;
  /** Estimate: payout if every player still in (you included) keeps the streak. */
  potentialPayout: bigint;
  potentialProfit: bigint;
  stillIn: number;
  participants: number;
  day: number | null;
  numDays: number;
  today: TodayStatus;
  /** End of the running day, or the start when not started. */
  countdownTo: number;
  countdownLabel: string;
  /** Inside the deadline-warning window (Phase 33 rule). */
  warning: boolean;
}

export interface DeadlineItem {
  at: number;
  label: string;
  title: string;
  address: string | null;
  warning: boolean;
}

const uncoveredFailure = (m: DashMembershipInput) =>
  Object.entries(m.results).some(([d, r]) => r === 'failed' && !m.shieldDays.includes(Number(d)));

export function todayStatus(m: DashMembershipInput, now: number): TodayStatus {
  const c = m.challenge;
  if (now < c.startTs) return 'not_started';
  const day = Math.floor((now - c.startTs) / c.dayLengthSecs);
  const recorded = m.results[day];
  if (recorded === 'verified') return 'verified';
  if (m.shieldDays.includes(day)) return 'shielded';
  if (recorded === 'failed') return 'failed';
  if (recorded === 'indeterminate') return 'undecided';
  if (m.status !== 'active' || uncoveredFailure(m)) return 'out';
  const check = m.checks[day];
  if (check === 'met') return 'on_track';
  if (check === 'not_met') return 'behind';
  if (check === 'unknown') return 'unknown';
  return 'not_checked';
}

/** A membership is "active" while its challenge is open and hasn't ended (or hasn't started). */
export function isActive(m: DashMembershipInput, now: number): boolean {
  const c = m.challenge;
  return c.poolState === 'open' && m.status === 'active' && now < c.startTs + c.numDays * c.dayLengthSecs;
}

export function activeChallenge(m: DashMembershipInput, now: number): ActiveChallenge {
  const c = m.challenge;
  const deadline = currentDeadline(c, now);
  const today = todayStatus(m, now);
  const viewerIn = today !== 'out' && today !== 'failed';
  // Everyone still in (at least the viewer) survives; the mirror's count can lag, so never below that.
  const participants = Math.max(1, c.participantCount, c.stillIn);
  const survivors = Math.min(participants, Math.max(1, c.stillIn));
  const s = computeSettlement({
    buyIn: c.buyIn,
    totalStake: c.buyIn * BigInt(participants),
    totalSponsor: c.totalSponsor,
    totalShield: c.totalShield,
    survivors,
    voided: 0,
  });
  const payout = viewerIn ? s.survivorPayout : 0n;
  return {
    membershipId: m.id,
    title: c.title,
    address: c.address,
    token: c.token,
    stake: m.deposited,
    potentialPayout: payout,
    potentialProfit: viewerIn ? payout - m.deposited : -m.deposited,
    stillIn: c.stillIn,
    participants,
    day: deadline?.day ?? null,
    numDays: c.numDays,
    today,
    countdownTo: deadline ? deadline.endsAt : c.startTs,
    countdownLabel: deadline ? `Day ${deadline.day + 1} of ${c.numDays} ends` : 'Starts',
    warning: Boolean(deadline?.due) && (today === 'behind' || today === 'not_checked' || today === 'unknown'),
  };
}

/** Upcoming times that matter, soonest first: day ends, starts, joining closes, the last day. */
export function upcomingDeadlines(ms: DashMembershipInput[], now: number, limit = 6): DeadlineItem[] {
  const out: DeadlineItem[] = [];
  for (const m of ms) {
    if (!isActive(m, now)) continue;
    const c = m.challenge;
    const base = { title: c.title, address: c.address };
    const end = c.startTs + c.numDays * c.dayLengthSecs;
    if (now < c.joinDeadlineTs) out.push({ ...base, at: c.joinDeadlineTs, label: 'Joining closes', warning: false });
    if (now < c.startTs) out.push({ ...base, at: c.startTs, label: 'Challenge starts', warning: false });
    const d = currentDeadline(c, now);
    if (d) {
      const today = todayStatus(m, now);
      const open = today === 'behind' || today === 'not_checked' || today === 'unknown';
      out.push({ ...base, at: d.endsAt, label: `Day ${d.day + 1} ends`, warning: d.due && open });
      if (d.day + 1 < c.numDays) out.push({ ...base, at: d.endsAt + c.dayLengthSecs, label: `Day ${d.day + 2} ends`, warning: false });
    }
    if (end > now && (!d || end !== d.endsAt)) out.push({ ...base, at: end, label: 'Last day ends', warning: false });
  }
  const seen = new Set<string>();
  return out
    .filter((x) => x.at > now && !seen.has(`${x.address}:${x.at}:${x.label}`) && seen.add(`${x.address}:${x.at}:${x.label}`))
    .sort((a, b) => a.at - b.at)
    .slice(0, limit);
}

/** Total stake still at risk in active challenges, per token. */
export function stakeAtRisk(ms: DashMembershipInput[], now: number): Record<Token, bigint> {
  const t: Record<Token, bigint> = { sol: 0n, usdc: 0n };
  for (const m of ms) if (isActive(m, now)) t[m.challenge.token] += m.deposited;
  return t;
}

// ------------------------------------------------------------------ activity chart

export interface ActivityPoint {
  /** YYYY-MM-DD (UTC). */
  date: string;
  /** Short label for the axis, e.g. "24 Nov". */
  label: string;
  verified: number;
  failed: number;
  shielded: number;
  undecided: number;
  commits: number;
  solves: number;
}

const DAY = 86_400;
const ymd = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The last `days` UTC dates (oldest first, empty dates included) with recorded results and counted
 * evidence. A challenge day counts on the UTC date its window started.
 */
export function activitySeries(
  results: { startedAt: number; result: 'verified' | 'failed' | 'indeterminate'; shielded: boolean }[],
  evidence: { at: number; provider: 'github' | 'leetcode' }[],
  now: number,
  days = 30,
): ActivityPoint[] {
  const today = Math.floor(now / DAY) * DAY;
  const points: ActivityPoint[] = [];
  const index = new Map<string, ActivityPoint>();
  for (let i = days - 1; i >= 0; i--) {
    const t = today - i * DAY;
    const d = new Date(t * 1000);
    const p: ActivityPoint = { date: ymd(t), label: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`, verified: 0, failed: 0, shielded: 0, undecided: 0, commits: 0, solves: 0 };
    points.push(p);
    index.set(p.date, p);
  }
  for (const r of results) {
    const p = index.get(ymd(r.startedAt));
    if (!p) continue;
    if (r.result === 'verified') p.verified++;
    else if (r.shielded) p.shielded++;
    else if (r.result === 'failed') p.failed++;
    else p.undecided++;
  }
  for (const e of evidence) {
    const p = index.get(ymd(e.at));
    if (!p) continue;
    if (e.provider === 'github') p.commits++;
    else p.solves++;
  }
  return points;
}

// ------------------------------------------------------------------ clocks

/** "21:30 UTC" / "03:00 IST" for a unix time. IST is UTC+05:30 all year (no daylight saving). */
export function zonedClock(unixSecs: number, zone: 'UTC' | 'IST'): string {
  const shifted = unixSecs + (zone === 'IST' ? 19_800 : 0);
  const d = new Date(shifted * 1000);
  const hm = d.toISOString().slice(11, 16);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}, ${hm} ${zone}`;
}

/** "2d 4h", "3h 05m", "4m 09s", "0s" until `target`. */
export function countdownText(target: number, now: number): string {
  const s = Math.max(0, Math.floor(target - now));
  const d = Math.floor(s / DAY);
  const h = Math.floor((s % DAY) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(sec)}s`;
  return `${sec}s`;
}

/** Whether a deadline just entered its warning window between two clock ticks (for the audio cue). */
export function crossedWarning(endsAt: number, dayLengthSecs: number, before: number, after: number): boolean {
  const warnAt = endsAt - warningLeadSecs(dayLengthSecs);
  return before < warnAt && after >= warnAt && after < endsAt;
}

/**
 * One time in both zones the app uses, e.g. "24 Nov, 14:50 UTC · 24 Nov, 20:20 IST". Accepts unix
 * seconds or an ISO string. Deterministic (never the browser's locale), so server and browser render
 * the same text and nothing shifts on hydration.
 */
export function utcAndIst(when: number | string): string {
  const s = typeof when === 'number' ? when : Math.floor(Date.parse(when) / 1000);
  return `${zonedClock(s, 'UTC')} · ${zonedClock(s, 'IST')}`;
}
