// Payout math, mirroring the program exactly (programs/codestreak/src/rules.rs: compute_settlement
// and reward_amount). Used for the reward estimate on challenge pages; the program decides the
// real split at settlement.

export interface SettlementInput {
  /** Stake per participant (base units). */
  buyIn: bigint;
  /** All stakes deposited (participants × buy-in). */
  totalStake: bigint;
  totalSponsor: bigint;
  totalShield: bigint;
  survivors: number;
  /** Voided participants (indeterminate days, no failures): stake back, no reward. */
  voided: number;
}

export interface SettlementResult {
  /** Nobody survived: every participant and sponsor gets everything back. */
  fullRefund: boolean;
  /** R = forfeited stakes + sponsorships + Shield payments. */
  rewardPool: bigint;
  /** floor(R / S). */
  rewardPerSurvivor: bigint;
  /** R - floor(R / S) × S, paid to the last survivor who claims. */
  rewardDust: bigint;
  /** What a survivor receives (stake + share), and the last claimer (+ dust). */
  survivorPayout: bigint;
  lastSurvivorPayout: bigint;
}

/** compute_settlement + reward_amount from the program, in bigint (no floats, no rounding up). */
export function computeSettlement(i: SettlementInput): SettlementResult {
  const survivors = BigInt(i.survivors);
  if (survivors === 0n) {
    return { fullRefund: true, rewardPool: 0n, rewardPerSurvivor: 0n, rewardDust: 0n, survivorPayout: 0n, lastSurvivorPayout: 0n };
  }
  const deposited = i.totalStake + i.totalSponsor + i.totalShield;
  const returnedStakes = (survivors + BigInt(i.voided)) * i.buyIn;
  if (returnedStakes > deposited) throw new RangeError('more stakes returned than deposited');
  const rewardPool = deposited - returnedStakes;
  const rewardPerSurvivor = rewardPool / survivors;
  const rewardDust = rewardPool - rewardPerSurvivor * survivors;
  const survivorPayout = i.buyIn + rewardPerSurvivor;
  return { fullRefund: false, rewardPool, rewardPerSurvivor, rewardDust, survivorPayout, lastSurvivorPayout: survivorPayout + rewardDust };
}

export interface EstimateInput {
  buyIn: bigint;
  /** Current participants on-chain (not counting the viewer). */
  participants: number;
  totalSponsor: bigint;
  totalShield: bigint;
  /** Assumed share of players who keep their streak, 0..1. */
  survivalRate: number;
  /** Count the viewer as an extra participant who survives (for "if you join"). */
  includeViewer: boolean;
}

export interface Estimate extends SettlementResult {
  participants: number;
  survivors: number;
  failed: number;
  /** survivorPayout - buyIn: what a survivor gains on top of their stake. */
  profit: bigint;
}

/**
 * "If you join and keep your streak": assumes `survivalRate` of the players survive (at least the
 * viewer when they are counted), nobody is voided, and the pool's sponsorships/Shields stay as now.
 */
export function estimateReward(i: EstimateInput): Estimate {
  const participants = i.participants + (i.includeViewer ? 1 : 0);
  const rate = Math.min(1, Math.max(0, Number.isFinite(i.survivalRate) ? i.survivalRate : 0));
  let survivors = Math.round(participants * rate);
  if (i.includeViewer) survivors = Math.max(1, survivors);
  survivors = Math.min(participants, survivors);
  const s = computeSettlement({
    buyIn: i.buyIn,
    totalStake: i.buyIn * BigInt(participants),
    totalSponsor: i.totalSponsor,
    totalShield: i.totalShield,
    survivors,
    voided: 0,
  });
  return { ...s, participants, survivors, failed: participants - survivors, profit: s.fullRefund ? 0n : s.survivorPayout - i.buyIn };
}

/** Survival so far: survivors / finalized once results are final, else players still in / players. */
export function survivalRate(stats: { members: number; stillIn: number; survived: number; finalized: number }): number | null {
  if (stats.finalized > 0) return stats.survived / stats.finalized;
  if (stats.members > 0) return stats.stillIn / stats.members;
  return null;
}

export type ChallengeStatus = 'joining' | 'starting' | 'running' | 'finished' | 'cancelled';

/** Coarse status for lists and filters (the detail page uses the full on-chain phase). */
export function challengeStatus(c: { poolState: 'open' | 'cancelled' | 'settled'; joinDeadlineMs: number; startMs: number; endMs: number }, nowMs: number): ChallengeStatus {
  if (c.poolState === 'cancelled') return 'cancelled';
  if (c.poolState === 'settled' || nowMs >= c.endMs) return 'finished';
  if (nowMs < c.joinDeadlineMs) return 'joining';
  if (nowMs < c.startMs) return 'starting';
  return 'running';
}
