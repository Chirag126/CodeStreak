import { describe, expect, it } from 'vitest';
import { challengeStatus, computeSettlement, estimateReward, survivalRate } from './payout.js';

// Fixtures are the program's own: programs/codestreak/src/rules.rs (settlement_math) and
// programs/codestreak/tests/settlement.rs (case 1..5), with the numbers the program produced.
const USDC = 1_000_000n;
const BUY_IN = 10n * USDC;
const SHIELD = 2n * USDC;

describe('computeSettlement matches the program', () => {
  it('rules.rs settlement_math: 5 joined at 10, 2 survived, 1 voided, sponsors 7, Shields 4', () => {
    const r = computeSettlement({ buyIn: 10n, totalStake: 50n, totalSponsor: 7n, totalShield: 4n, survivors: 2, voided: 1 });
    expect(r).toMatchObject({ fullRefund: false, rewardPool: 31n, rewardPerSurvivor: 15n, rewardDust: 1n, survivorPayout: 25n, lastSurvivorPayout: 26n });
    // Every token goes somewhere: 2 survivors + dust + 1 voided stake = everything deposited.
    expect(r.survivorPayout * 2n + r.rewardDust + 10n).toBe(50n + 7n + 4n);
  });

  it('case 1: forfeit + sponsor 1.000001 + one Shield, 2 survivors, dust to the last claimer', () => {
    const r = computeSettlement({ buyIn: BUY_IN, totalStake: 3n * BUY_IN, totalSponsor: 1_000_001n, totalShield: SHIELD, survivors: 2, voided: 0 });
    expect(r).toMatchObject({ rewardPool: 13_000_001n, rewardPerSurvivor: 6_500_000n, rewardDust: 1n });
    expect(r.survivorPayout).toBe(BUY_IN + 6_500_000n);
    expect(r.lastSurvivorPayout).toBe(BUY_IN + 6_500_000n + 1n);
  });

  it('case 2: everyone survives and shares the sponsorship', () => {
    const r = computeSettlement({ buyIn: BUY_IN, totalStake: 2n * BUY_IN, totalSponsor: 3n * USDC, totalShield: 0n, survivors: 2, voided: 0 });
    expect(r).toMatchObject({ rewardPool: 3n * USDC, rewardPerSurvivor: 1_500_000n, rewardDust: 0n });
  });

  it('case 3 and 5: nobody survives -> full refund', () => {
    expect(computeSettlement({ buyIn: BUY_IN, totalStake: 2n * BUY_IN, totalSponsor: 5n * USDC, totalShield: SHIELD, survivors: 0, voided: 0 }).fullRefund).toBe(true);
    expect(computeSettlement({ buyIn: BUY_IN, totalStake: 2n * BUY_IN, totalSponsor: 4n * USDC, totalShield: 0n, survivors: 0, voided: 2 }).fullRefund).toBe(true);
  });

  it('case 4: voided players get their stake back; one failure funds the one survivor', () => {
    const r = computeSettlement({ buyIn: BUY_IN, totalStake: 4n * BUY_IN, totalSponsor: 0n, totalShield: 0n, survivors: 1, voided: 2 });
    expect(r).toMatchObject({ rewardPool: BUY_IN, rewardPerSurvivor: BUY_IN, survivorPayout: 2n * BUY_IN });
  });
});

describe('reward estimate', () => {
  it('uses the same formula: 9 players + you, 70% survive', () => {
    const e = estimateReward({ buyIn: BUY_IN, participants: 9, totalSponsor: 0n, totalShield: 0n, survivalRate: 0.7, includeViewer: true });
    expect([e.participants, e.survivors, e.failed]).toEqual([10, 7, 3]);
    // R = 3 forfeited stakes = 30 USDC; 7 survivors -> 4.285714 each, dust 2 base units.
    expect(e.rewardPool).toBe(30n * USDC);
    expect(e.rewardPerSurvivor).toBe(4_285_714n);
    expect(e.rewardDust).toBe(2n);
    expect(e.profit).toBe(4_285_714n);
  });

  it('counts sponsorships, never lets you be the only one counted as failing, and clamps the rate', () => {
    expect(estimateReward({ buyIn: BUY_IN, participants: 0, totalSponsor: 5n * USDC, totalShield: 0n, survivalRate: 0, includeViewer: true })).toMatchObject({
      survivors: 1,
      profit: 5n * USDC,
    });
    expect(estimateReward({ buyIn: BUY_IN, participants: 4, totalSponsor: 0n, totalShield: 0n, survivalRate: 2, includeViewer: false }).survivors).toBe(4);
    expect(estimateReward({ buyIn: BUY_IN, participants: 4, totalSponsor: 0n, totalShield: 0n, survivalRate: 1, includeViewer: false }).profit).toBe(0n);
  });
});

describe('stats', () => {
  it('survival rate: final results first, then players still in', () => {
    expect(survivalRate({ members: 4, stillIn: 3, survived: 0, finalized: 0 })).toBe(0.75);
    expect(survivalRate({ members: 4, stillIn: 3, survived: 1, finalized: 4 })).toBe(0.25);
    expect(survivalRate({ members: 0, stillIn: 0, survived: 0, finalized: 0 })).toBeNull();
  });

  it('status from the clock', () => {
    const c = { poolState: 'open' as const, joinDeadlineMs: 100, startMs: 200, endMs: 300 };
    expect([50, 150, 250, 300].map((t) => challengeStatus(c, t))).toEqual(['joining', 'starting', 'running', 'finished']);
    expect(challengeStatus({ ...c, poolState: 'cancelled' }, 50)).toBe('cancelled');
    expect(challengeStatus({ ...c, poolState: 'settled' }, 50)).toBe('finished');
  });
});
