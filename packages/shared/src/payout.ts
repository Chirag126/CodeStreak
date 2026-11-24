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

// ---------------------------------------------------------------- claims (Phase 30)

/** The settlement fields of a Challenge account that decide what a claim pays. */
export interface ClaimChallenge {
  state: 'open' | 'cancelled' | 'settled';
  fullRefund: boolean;
  buyIn: bigint;
  totalStake: bigint;
  totalSponsor: bigint;
  totalShield: bigint;
  survivorCount: number;
  voidedCount: number;
  rewardPerSurvivor: bigint;
  rewardDust: bigint;
  survivorsClaimed: number;
}

/** The fields of a Participant account that decide what it is owed. */
export interface ClaimParticipant {
  deposited: bigint;
  shieldPaid: bigint;
  status: 'active' | 'survived' | 'failed' | 'voided';
  finalized: boolean;
  claimed: boolean;
}

export type ClaimKind = 'reward' | 'refund';

/**
 * What one claim instruction pays right now, exactly as the program computes it (rules.rs
 * reward_amount / participant_refund_amount), or null when nothing can be claimed:
 *   cancelled, or settled with nobody surviving  -> refund of everything paid in (stake + Shields)
 *   settled, voided                              -> refund of the stake (Shields stay in the pool)
 *   settled, survived                            -> stake + equal share (+ the dust for the last claimer)
 *   failed, still open, not finalized, claimed   -> nothing
 */
export function claimable(c: ClaimChallenge, p: ClaimParticipant): { kind: ClaimKind; amount: bigint } | null {
  if (p.claimed) return null;
  const everything = p.deposited + p.shieldPaid;
  if (c.state === 'cancelled') return { kind: 'refund', amount: everything };
  if (c.state !== 'settled' || !p.finalized) return null;
  if (c.fullRefund) return { kind: 'refund', amount: everything };
  if (p.status === 'voided') return { kind: 'refund', amount: p.deposited };
  if (p.status === 'survived') {
    const last = c.survivorsClaimed + 1 === c.survivorCount;
    return { kind: 'reward', amount: p.deposited + c.rewardPerSurvivor + (last ? c.rewardDust : 0n) };
  }
  return null;
}

/** Why a claim isn't possible (yet), in plain words; null when it is. */
export type ClaimBlock = 'not_settled' | 'not_finalized' | 'already_paid' | 'nothing_owed';

export function claimBlock(c: ClaimChallenge, p: ClaimParticipant): ClaimBlock | null {
  if (p.claimed) return 'already_paid';
  if (c.state === 'open') return 'not_settled';
  if (c.state === 'settled' && !p.finalized) return 'not_finalized';
  return claimable(c, p) ? null : 'nothing_owed';
}

export interface PayoutLine {
  label: string;
  amount: bigint;
  /** Shown as money leaving the payout (e.g. Shields kept by the pool). */
  negative?: boolean;
  note?: string;
}

/** Where a payout comes from, line by line (same math as `claimable`). `paid` = the amount actually received, if known. */
export function payoutBreakdown(c: ClaimChallenge, p: ClaimParticipant, paid?: bigint | null): { lines: PayoutLine[]; total: bigint } {
  const lines: PayoutLine[] = [{ label: 'Your stake back', amount: p.deposited }];
  if (c.state === 'cancelled' || (c.state === 'settled' && c.fullRefund)) {
    if (p.shieldPaid > 0n) lines.push({ label: 'Shields refunded', amount: p.shieldPaid });
    const total = p.deposited + p.shieldPaid;
    return { lines, total: paid ?? total };
  }
  if (p.status === 'failed') {
    return { lines: [{ label: 'Your stake', amount: p.deposited, negative: true, note: 'Shared between the players who kept their streak' }], total: 0n };
  }
  if (p.status === 'voided') {
    if (p.shieldPaid > 0n) lines.push({ label: 'Shields bought', amount: p.shieldPaid, negative: true, note: 'Shields stay in the pool' });
    return { lines, total: paid ?? p.deposited };
  }
  // Survived: the share of the reward pool, by where the pool came from.
  const forfeited = c.totalStake - BigInt(c.survivorCount + c.voidedCount) * c.buyIn;
  const survivors = BigInt(Math.max(1, c.survivorCount));
  const share = paid != null ? paid - p.deposited : c.rewardPerSurvivor;
  lines.push({
    label: 'Your share of the pool',
    amount: share,
    note: `${c.survivorCount} survivor${c.survivorCount === 1 ? '' : 's'} split missed stakes, sponsorships and Shields`,
  });
  if (forfeited > 0n) lines.push({ label: '· from missed stakes', amount: forfeited / survivors, note: 'per survivor' });
  if (c.totalSponsor > 0n) lines.push({ label: '· from sponsorships', amount: c.totalSponsor / survivors, note: 'per survivor' });
  if (c.totalShield > 0n) lines.push({ label: '· from Shields', amount: c.totalShield / survivors, note: 'per survivor' });
  if (p.shieldPaid > 0n) lines.push({ label: 'Shields you bought', amount: p.shieldPaid, negative: true, note: 'already part of the pool' });
  return { lines, total: p.deposited + share };
}
