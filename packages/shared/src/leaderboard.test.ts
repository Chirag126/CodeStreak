import { describe, expect, it } from 'vitest';
import { buildLeaderboard, rankChanges, type LeaderMembership } from './leaderboard.js';

// Hand-computed fixtures. Week of Monday 2026-11-23 (UTC); "now" is Wednesday 12:00 UTC.
const DAY = 86_400;
const MON = Date.UTC(2026, 10, 23) / 1000;
const NOW = MON + 2 * DAY + 43_200;
const C1_START = MON - 2 * DAY; // Saturday: days 0-1 last week, days 2-4 this week (Mon, Tue, Wed)

type R = LeaderMembership['results'][number]['result'];
const res = (...rs: (R | null)[]) => rs.flatMap((result, day) => (result ? [{ day, result }] : []));

function m(name: string, over: Partial<LeaderMembership>): LeaderMembership {
  return {
    profileId: name.toLowerCase(),
    username: name.toLowerCase(),
    displayName: name,
    challengeId: 'c1',
    token: 'usdc',
    startTs: C1_START,
    dayLengthSecs: DAY,
    status: 'active',
    deposited: 10_000_000n,
    payout: null,
    results: [],
    shieldDays: [],
    ...over,
  };
}

const FIXTURE: LeaderMembership[] = [
  // Alice: V V | V V V → this week 3, longest 5 (current 5), 5/5 = 100 %. Won 5 USDC.
  m('Alice', { results: res('verified', 'verified', 'verified', 'verified', 'verified'), status: 'survived', payout: 15_000_000n }),
  // Bob: V F | V V F(shielded day 4) → this week 3 (the Shield keeps day 4), runs 1,0,1,2,3 → longest 3,
  // success 3 / (3 + 1 uncovered) = 75 %.
  m('Bob', { results: res('verified', 'failed', 'verified', 'verified', 'failed'), shieldDays: [4] }),
  // Bob also won a different USDC challenge: +2 USDC.
  m('Bob', { challengeId: 'c3', startTs: MON - 40 * DAY, status: 'survived', payout: 12_000_000n }),
  // Carol: two verified days three weeks ago → not this week, longest 2, only 2 decided (< 3) → not consistent.
  // Her win is in SOL, so she's on the SOL earners board only.
  m('Carol', { challengeId: 'c2', token: 'sol', startTs: MON - 20 * DAY, results: res('verified', 'verified'), status: 'survived', payout: 3_000_000_000n, deposited: 1_000_000_000n }),
  // Dave: — — F ? V → this week 1 (only day 4 kept), longest 1, decided 2 → not consistent. Failed: no payout.
  m('Dave', { results: res(null, null, 'failed', 'indeterminate', 'verified'), status: 'failed' }),
  // Eve survived but was paid exactly her stake back (no reward) → not an earner; no recorded days.
  m('Eve', { challengeId: 'c4', status: 'survived', payout: 10_000_000n }),
];

const view = (kind: Parameters<typeof buildLeaderboard>[0], opts = {}) =>
  buildLeaderboard(kind, FIXTURE, NOW, opts).map((e) => [e.name, e.rank, typeof e.score === 'bigint' ? e.score.toString() : e.score]);

describe('leaderboards match hand-computed fixtures', () => {
  it('this week: kept days since Monday; ties share a rank (1, 1, 3)', () => {
    expect(view('weekly')).toEqual([
      ['Alice', 1, 3],
      ['Bob', 1, 3],
      ['Dave', 3, 1],
    ]);
  });

  it('longest streak, across all challenges, Shields keep a day', () => {
    expect(view('streak')).toEqual([
      ['Alice', 1, 5],
      ['Bob', 2, 3],
      ['Carol', 3, 2],
      ['Dave', 4, 1],
    ]);
  });

  it('most consistent: at least 3 decided days', () => {
    expect(view('consistent')).toEqual([
      ['Alice', 1, 100],
      ['Bob', 2, 75],
    ]);
  });

  it('top earners per token: reward above the stake, survivors with a payout only', () => {
    expect(view('earners', { token: 'usdc' })).toEqual([
      ['Alice', 1, '5000000'],
      ['Bob', 2, '2000000'],
    ]);
    expect(view('earners', { token: 'sol' })).toEqual([['Carol', 1, '2000000000']]);
  });

  it('a tie on score is broken by the tie-breaker before sharing a rank', () => {
    // Two 100 % players: 6 decided days ranks above 3 decided days.
    const extra = [
      m('Zed', { challengeId: 'z', results: res('verified', 'verified', 'verified', 'verified', 'verified', 'verified') }),
      m('Amy', { challengeId: 'a', results: res('verified', 'verified', 'verified') }),
    ];
    expect(buildLeaderboard('consistent', extra, NOW).map((e) => [e.name, e.rank])).toEqual([
      ['Zed', 1],
      ['Amy', 2],
    ]);
  });

  it('respects the limit', () => {
    expect(buildLeaderboard('streak', FIXTURE, NOW, { limit: 2 })).toHaveLength(2);
  });
});

describe('rank changes (for the animation)', () => {
  it('positive = moved up, null = new on the board', () => {
    const next = buildLeaderboard('streak', FIXTURE, NOW);
    const moves = rankChanges(new Map([['alice', 2], ['bob', 1]]), next);
    expect(moves.get('alice')).toBe(1);
    expect(moves.get('bob')).toBe(-1);
    expect(moves.get('carol')).toBeNull();
  });
});
