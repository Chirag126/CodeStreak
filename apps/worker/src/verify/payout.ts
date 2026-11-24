import type { ChainChallenge, ChainParticipant } from './chain.js';

/** What a participant is owed now (mirrors programs/codestreak/src/rules.rs), or null. */
export function participantPayout(c: ChainChallenge, p: ChainParticipant): { kind: 'reward' | 'refund'; amount: bigint } | null {
  if (p.claimed) return null;
  const everything = p.deposited + p.shieldPaid;
  if (c.times.state === 'cancelled') return { kind: 'refund', amount: everything };
  if (c.times.state !== 'settled' || !p.finalized) return null;
  if (c.fullRefund) return { kind: 'refund', amount: everything };
  if (p.status === 'voided') return { kind: 'refund', amount: p.deposited };
  if (p.status === 'survived') {
    const last = c.survivorsClaimed + 1 === c.survivorCount;
    return { kind: 'reward', amount: p.deposited + c.rewardPerSurvivor + (last ? c.rewardDust : 0n) };
  }
  return null; // failed: their stake is part of the survivors' rewards
}
