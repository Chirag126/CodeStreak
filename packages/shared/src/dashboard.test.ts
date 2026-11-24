import { describe, expect, it } from 'vitest';
import {
  activeChallenge,
  activitySeries,
  countdownText,
  crossedWarning,
  isActive,
  stakeAtRisk,
  todayStatus,
  upcomingDeadlines,
  zonedClock,
  type DashMembershipInput,
} from './dashboard.js';

const START = 1_800_000_000; // a Friday, 2027-01-15 08:00 UTC
const DAY = 86_400;

function member(over: Partial<DashMembershipInput> = {}, c: Partial<DashMembershipInput['challenge']> = {}): DashMembershipInput {
  return {
    id: 'm1',
    status: 'active',
    deposited: 10_000_000n,
    results: {},
    shieldDays: [],
    checks: {},
    ...over,
    challenge: {
      id: 'c1',
      title: 'Ship daily',
      address: 'Addr1',
      token: 'usdc',
      buyIn: 10_000_000n,
      poolState: 'open',
      startTs: START,
      dayLengthSecs: DAY,
      numDays: 7,
      joinDeadlineTs: START - 3600,
      participantCount: 4,
      totalSponsor: 0n,
      totalShield: 0n,
      stillIn: 4,
      ...c,
    },
  };
}

describe('today status', () => {
  it('prefers the on-chain record, then a Shield, then the latest check', () => {
    const now = START + 2 * DAY + 100; // day 2
    expect(todayStatus(member(), START - 10)).toBe('not_started');
    expect(todayStatus(member(), now)).toBe('not_checked');
    expect(todayStatus(member({ checks: { 2: 'met' } }), now)).toBe('on_track');
    expect(todayStatus(member({ checks: { 2: 'not_met' } }), now)).toBe('behind');
    expect(todayStatus(member({ checks: { 2: 'unknown' } }), now)).toBe('unknown');
    expect(todayStatus(member({ checks: { 2: 'not_met' }, shieldDays: [2] }), now)).toBe('shielded');
    expect(todayStatus(member({ results: { 2: 'verified' } }), now)).toBe('verified');
    expect(todayStatus(member({ results: { 2: 'failed' } }), now)).toBe('failed');
  });

  it('an earlier uncovered failure ends the streak; a shielded one does not', () => {
    const now = START + 2 * DAY + 100;
    expect(todayStatus(member({ results: { 0: 'failed' }, checks: { 2: 'met' } }), now)).toBe('out');
    expect(todayStatus(member({ results: { 0: 'failed' }, shieldDays: [0], checks: { 2: 'met' } }), now)).toBe('on_track');
  });
});

describe('active challenge', () => {
  it('stake, potential payout if everyone still in survives, and the running day countdown', () => {
    // 4 players × 10 USDC + 6 USDC sponsored; 3 still in → each survivor gets 10 + (46 - 30) / 3.
    const a = activeChallenge(member({}, { stillIn: 3, totalSponsor: 6_000_000n }), START + DAY + 60);
    expect(a.stake).toBe(10_000_000n);
    expect(a.potentialPayout).toBe(10_000_000n + 16_000_000n / 3n);
    expect(a.potentialProfit).toBe(16_000_000n / 3n);
    expect(a.day).toBe(1);
    expect(a.countdownTo).toBe(START + 2 * DAY);
    expect(a.countdownLabel).toBe('Day 2 of 7 ends');
  });

  it('a player who is out has no potential payout, and before the start counts down to it', () => {
    const out = activeChallenge(member({ results: { 0: 'failed' } }), START + DAY + 60);
    expect(out.potentialPayout).toBe(0n);
    expect(out.potentialProfit).toBe(-10_000_000n);
    const early = activeChallenge(member(), START - 600);
    expect(early).toMatchObject({ day: null, countdownTo: START, countdownLabel: 'Starts', today: 'not_started' });
  });

  it('never throws when the mirrored player count lags behind', () => {
    expect(() => activeChallenge(member({}, { participantCount: 0, stillIn: 0 }), START + 10)).not.toThrow();
  });

  it('warns only inside the warning window and only while the day is still open', () => {
    const late = START + DAY - 3600; // 1 h before the end (warning is 3 h for real days)
    expect(activeChallenge(member(), late).warning).toBe(true);
    expect(activeChallenge(member({ checks: { 0: 'met' } }), late).warning).toBe(false);
    expect(activeChallenge(member(), START + 3600).warning).toBe(false);
  });
});

describe('deadlines and stake', () => {
  it('lists upcoming times soonest first, only for active challenges', () => {
    const ms = [member(), member({ id: 'm2' }, { id: 'c2', title: 'Old', poolState: 'settled' })];
    const items = upcomingDeadlines(ms, START + 100);
    expect(items.map((i) => i.label)).toEqual(['Day 1 ends', 'Day 2 ends', 'Last day ends']);
    expect(items.every((i) => i.title === 'Ship daily')).toBe(true);
    expect(upcomingDeadlines([member()], START - 7200).map((i) => i.label)).toEqual(['Joining closes', 'Challenge starts', 'Last day ends']);
  });

  it('counts stake at risk per token in active challenges only', () => {
    const ms = [member(), member({ id: 'm2', deposited: 5n }, { token: 'sol' }), member({ id: 'm3', status: 'failed' })];
    expect(stakeAtRisk(ms, START + 10)).toEqual({ usdc: 10_000_000n, sol: 5n });
    expect(isActive(member(), START + 7 * DAY)).toBe(false);
  });
});

describe('activity series', () => {
  it('fills every UTC date, oldest first, and buckets results and evidence', () => {
    const now = START + 3 * DAY;
    const s = activitySeries(
      [
        { startedAt: START, result: 'verified', shielded: false },
        { startedAt: START + DAY, result: 'failed', shielded: true },
        { startedAt: START + 2 * DAY, result: 'failed', shielded: false },
        { startedAt: START - 400 * DAY, result: 'verified', shielded: false }, // outside the window
      ],
      [
        { at: START, provider: 'github' },
        { at: START, provider: 'github' },
        { at: START + 2 * DAY, provider: 'leetcode' },
      ],
      now,
      7,
    );
    expect(s).toHaveLength(7);
    expect(s.at(-1)!.date).toBe(new Date(now * 1000).toISOString().slice(0, 10));
    const at = (t: number) => s.find((p) => p.date === new Date(t * 1000).toISOString().slice(0, 10))!;
    expect(at(START)).toMatchObject({ verified: 1, commits: 2 });
    expect(at(START + DAY)).toMatchObject({ shielded: 1, failed: 0 });
    expect(at(START + 2 * DAY)).toMatchObject({ failed: 1, solves: 1 });
    expect(s.reduce((a, p) => a + p.verified + p.failed + p.shielded, 0)).toBe(3);
  });
});

describe('clocks', () => {
  it('UTC and IST (+05:30, crossing midnight)', () => {
    const t = Date.UTC(2026, 10, 24, 20, 15) / 1000;
    expect(zonedClock(t, 'UTC')).toBe('24 Nov, 20:15 UTC');
    expect(zonedClock(t, 'IST')).toBe('25 Nov, 01:45 IST');
  });

  it('countdown text', () => {
    expect(countdownText(100 + 2 * DAY + 5 * 3600, 100)).toBe('2d 5h');
    expect(countdownText(100 + 3 * 3600 + 5 * 60, 100)).toBe('3h 05m');
    expect(countdownText(100 + 4 * 60 + 9, 100)).toBe('4m 09s');
    expect(countdownText(50, 100)).toBe('0s');
  });

  it('detects entering the warning window exactly once', () => {
    const end = START + DAY;
    const warnAt = end - 3 * 3600;
    expect(crossedWarning(end, DAY, warnAt - 1, warnAt)).toBe(true);
    expect(crossedWarning(end, DAY, warnAt, warnAt + 1)).toBe(false);
    expect(crossedWarning(end, DAY, end - 1, end)).toBe(false);
  });
});
