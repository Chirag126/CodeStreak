// The database's copy of a Challenge account: one definition shared by the web's sync (after a
// create/join/sponsor) and the worker's reconciliation, so both always write the same values.
import { WSOL_MINT } from '../constants.js';
import type { ChallengeAccount } from './client.js';
import { enumVariant, type PoolStateName } from './lifecycle.js';

const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();

export interface ChallengeMirrorRow {
  onchain_address: string;
  onchain_challenge_id: string;
  mint: string;
  vault: string;
  token: 'sol' | 'usdc';
  visibility: 'public' | 'private';
  buy_in: string;
  start_at: string;
  day_length_secs: number;
  num_days: number;
  join_deadline_at: string;
  min_participants: number;
  max_participants: number;
  shield_price: string;
  max_shields: number;
  shield_grace_secs: number;
  verify_window_secs: number;
  dispute_window_secs: number;
  rules_hash: string;
  pool_state: PoolStateName;
  participant_count: number;
  total_stake: string;
  total_sponsor: string;
  total_shield: string;
}

/** Fields that change during a challenge's life (the rest are fixed at creation). */
export const MIRRORED_STATE_FIELDS = ['pool_state', 'participant_count', 'total_stake', 'total_sponsor', 'total_shield'] as const;

export function challengeMirrorRow(address: string, c: ChallengeAccount): ChallengeMirrorRow {
  return {
    onchain_address: address,
    onchain_challenge_id: c.challengeId.toString(),
    mint: c.mint.toBase58(),
    vault: c.vault.toBase58(),
    token: c.mint.toBase58() === WSOL_MINT ? 'sol' : 'usdc',
    visibility: c.joinAuthority ? 'private' : 'public',
    buy_in: c.buyIn.toString(),
    start_at: iso(c.startTs.toNumber()),
    day_length_secs: c.dayLengthSecs,
    num_days: c.numDays,
    join_deadline_at: iso(c.joinDeadlineTs.toNumber()),
    min_participants: c.minParticipants,
    max_participants: c.maxParticipants,
    shield_price: c.shieldPrice.toString(),
    max_shields: c.maxShieldsPerParticipant,
    shield_grace_secs: c.shieldGraceSecs,
    verify_window_secs: c.verifyWindowSecs,
    dispute_window_secs: c.disputeWindowSecs,
    rules_hash: Buffer.from(c.rulesHash).toString('hex'),
    pool_state: enumVariant<PoolStateName>(c.state),
    participant_count: c.participantCount,
    total_stake: c.totalStake.toString(),
    total_sponsor: c.totalSponsor.toString(),
    total_shield: c.totalShield.toString(),
  };
}
