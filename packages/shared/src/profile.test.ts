import { describe, expect, it } from 'vitest';
import { buildPublicProfile, usernameFromPath, type ProfileChallengeInput } from './profile.js';

const DAY = 86_400;
const NOW = Date.UTC(2026, 10, 25, 12) / 1000;

const row = (over: Partial<ProfileChallengeInput>): ProfileChallengeInput => ({
  visibility: 'public',
  title: 'Ship daily',
  address: 'PubAddr1',
  token: 'sol',
  startTs: NOW - 10 * DAY,
  dayLengthSecs: DAY,
  numDays: 3,
  poolState: 'settled',
  status: 'survived',
  deposited: 50_000_000n,
  payout: 140_000_000n,
  results: [
    { day: 0, result: 'verified' },
    { day: 1, result: 'verified' },
    { day: 2, result: 'verified' },
  ],
  shieldDays: [],
  joinTx: 'joinSig',
  payoutTx: 'paySig',
  badge: { mint: 'MintPub', tx: 'mintSig', inWallet: true },
  ...over,
});

const SECRET = row({
  visibility: 'private',
  title: 'Secret Squad',
  address: 'PrivAddr9',
  startTs: NOW - 5 * DAY,
  results: [
    { day: 0, result: 'failed' },
    { day: 1, result: 'failed' },
  ],
  status: 'failed',
  payout: null,
  joinTx: 'privJoinSig',
  payoutTx: null,
  badge: { mint: 'MintPriv', tx: 'privMintSig', inWallet: true },
});

describe('public profile', () => {
  it('never leaks anything from a private group, in any field', () => {
    const out = buildPublicProfile([row({}), SECRET], NOW);
    const json = JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    for (const secret of ['Secret Squad', 'PrivAddr9', 'privJoinSig', 'MintPriv', 'privMintSig']) expect(json).not.toContain(secret);
    // Its days don't move the numbers either: 3 verified public days → 100 %, streak 3.
    expect(out.stats).toMatchObject({ challenges: 1, survived: 1, successRate: 100, longestStreak: 3, recordedDays: 3 });
  });

  it('also drops rows without an on-chain address', () => {
    expect(buildPublicProfile([row({ address: null })], NOW).history).toEqual([]);
  });

  it('stats, earnings above the stake per token, history and on-chain badges', () => {
    const out = buildPublicProfile(
      [
        row({}),
        row({ title: 'USDC week', address: 'PubAddr2', token: 'usdc', deposited: 10_000_000n, payout: 10_000_000n, badge: null, startTs: NOW - 3 * DAY }),
        row({
          title: 'Lost one',
          address: 'PubAddr3',
          status: 'failed',
          payout: null,
          badge: null,
          startTs: NOW - 20 * DAY,
          results: [
            { day: 0, result: 'verified' },
            { day: 1, result: 'failed' },
          ],
          shieldDays: [],
        }),
      ],
      NOW,
    );
    expect(out.stats.earned).toEqual({ sol: 90_000_000n }); // 0.14 − 0.05; the USDC refund-sized payout is not earnings
    expect(out.history.map((h) => [h.title, h.outcome])).toEqual([
      ['USDC week', 'survived'],
      ['Ship daily', 'survived'],
      ['Lost one', 'failed'],
    ]);
    expect(out.history.find((h) => h.title === 'Lost one')).toMatchObject({ verified: 1, failed: 1, shielded: 0 });
    expect(out.badges).toEqual([{ title: 'Ship daily', address: 'PubAddr1', numDays: 3, mint: 'MintPub', tx: 'mintSig', inWallet: true }]);
  });

  it('a Shield-covered missed day is shielded, not failed', () => {
    const out = buildPublicProfile([row({ results: [{ day: 0, result: 'failed' }], shieldDays: [0] })], NOW);
    expect(out.history[0]).toMatchObject({ failed: 0, shielded: 1 });
  });
});

describe('usernames in URLs', () => {
  it('normalises and rejects anything that is not a username', () => {
    expect(usernameFromPath('Chirag')).toBe('chirag');
    expect(usernameFromPath('%40chirag')).toBe('chirag');
    expect(usernameFromPath('ab')).toBeNull();
    expect(usernameFromPath('a/b')).toBeNull();
    expect(usernameFromPath("x' or 1=1")).toBeNull();
    expect(usernameFromPath('%E0%A4%A')).toBeNull();
  });
});
