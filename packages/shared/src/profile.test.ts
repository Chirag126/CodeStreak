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
  it('never leaks a private group\'s details, in any field', () => {
    const out = buildPublicProfile([row({}), SECRET], NOW);
    const json = JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    for (const secret of ['Secret Squad', 'PrivAddr9', 'privJoinSig', 'MintPriv', 'privMintSig']) expect(json).not.toContain(secret);
    expect(out.history.map((h) => h.title)).toEqual(['Ship daily']);
    expect(out.privateChallenges).toBe(1);
  });

  it('but the player\'s own achievements in private groups still count, anonymously', () => {
    const won = row({ ...SECRET, status: 'survived', payout: 140_000_000n, results: [{ day: 0, result: 'verified' }] });
    const out = buildPublicProfile([row({}), won], NOW);
    // 3 public verified days + 1 private verified day.
    expect(out.stats).toMatchObject({ challenges: 2, finished: 2, survived: 2, recordedDays: 4, successRate: 100 });
    expect(out.stats.earned).toEqual({ sol: 180_000_000n }); // 0.09 + 0.09
    const priv = out.badges.find((b) => b.isPrivate)!;
    expect(priv).toEqual({ title: 'Private challenge', address: null, numDays: 3, mint: null, tx: null, isPrivate: true, inWallet: true });
  });

  it('a private failure lowers the success rate (numbers only)', () => {
    const out = buildPublicProfile([row({}), SECRET], NOW);
    // 3 public verified + 2 private failed → 3 / 5 = 60 %.
    expect(out.stats).toMatchObject({ successRate: 60, recordedDays: 5, survived: 1 });
  });

  it('drops rows without an on-chain address, and labels a nobody-survived refund', () => {
    expect(buildPublicProfile([row({ address: null })], NOW).history).toEqual([]);
    const refunded = buildPublicProfile([row({ status: 'failed', payout: 20_000_000n, deposited: 10_000_000n, badge: null })], NOW);
    expect(refunded.history[0]!.outcome).toBe('refunded');
    expect(refunded.stats.earned).toEqual({});
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
    expect(out.badges).toEqual([{ title: 'Ship daily', address: 'PubAddr1', numDays: 3, mint: 'MintPub', tx: 'mintSig', isPrivate: false, inWallet: true }]);
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
