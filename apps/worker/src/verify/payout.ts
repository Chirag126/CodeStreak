import { claimable } from '@codestreak/shared';
import type { ChainChallenge, ChainParticipant } from './chain.js';

/** What a participant is owed now: the shared claim math (packages/shared/src/payout.ts), or null. */
export function participantPayout(c: ChainChallenge, p: ChainParticipant): { kind: 'reward' | 'refund'; amount: bigint } | null {
  return claimable(
    {
      state: c.times.state,
      fullRefund: c.fullRefund,
      buyIn: 0n,
      totalStake: 0n,
      totalSponsor: 0n,
      totalShield: 0n,
      survivorCount: c.survivorCount,
      voidedCount: 0,
      rewardPerSurvivor: c.rewardPerSurvivor,
      rewardDust: c.rewardDust,
      survivorsClaimed: c.survivorsClaimed,
    },
    p,
  );
}
