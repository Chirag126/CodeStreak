import 'server-only';

import { WSOL_MINT } from '@codestreak/shared';
import { createProgram, enumVariant, participantPda, type ChallengeAccount } from '@codestreak/shared/program';
import { PublicKey, type Connection } from '@solana/web3.js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();
const hex = (bytes: number[]) => Buffer.from(bytes).toString('hex');

/** The app's view of a Challenge account. Everything comes from the chain. */
function challengeRow(address: string, c: ChallengeAccount) {
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
    rules_hash: hex(c.rulesHash),
    pool_state: enumVariant<'open' | 'cancelled' | 'settled'>(c.state),
    participant_count: c.participantCount,
    total_stake: c.totalStake.toString(),
    total_sponsor: c.totalSponsor.toString(),
    total_shield: c.totalShield.toString(),
  };
}

/**
 * Mirrors a challenge into `challenges` (insert on first sight, then refresh the mirrored fields).
 * Returns the row id, or null if the account doesn't exist.
 */
export async function syncChallenge(connection: Connection, address: string): Promise<string | null> {
  const program = createProgram(connection);
  const account = await program.account.challenge.fetchNullable(new PublicKey(address));
  if (!account) return null;
  const admin = createSupabaseAdminClient();
  const mirror = challengeRow(address, account);

  const { data: existing } = await admin.from('challenges').select('id').eq('onchain_address', address).maybeSingle();
  if (existing) {
    const { error } = await admin.from('challenges').update(mirror).eq('id', existing.id);
    if (error) throw new Error(`challenge sync failed: ${error.message}`);
    return existing.id as string;
  }

  // First sight: attribute it to the creator's profile if their wallet is linked.
  const { data: creatorWallet } = await admin.from('wallets').select('profile_id').eq('address', account.creator.toBase58()).maybeSingle();
  const { data: inserted, error } = await admin
    .from('challenges')
    .insert({
      ...mirror,
      creator_id: (creatorWallet?.profile_id as string | undefined) ?? null,
      title: `${account.isDemo ? 'Demo challenge' : 'Challenge'} ${address.slice(0, 4)}`,
      rules: { source: 'chain', note: 'Created outside the app; the on-chain rules hash is authoritative.' },
    })
    .select('id')
    .single();
  if (error) throw new Error(`challenge sync failed: ${error.message}`);
  return inserted.id as string;
}

/** After a confirmed join: mirror the challenge, the membership and the receipt (idempotent). */
export async function syncJoin(connection: Connection, input: { challengeAddress: string; wallet: string; profileId: string; signature: string }): Promise<void> {
  const challengeId = await syncChallenge(connection, input.challengeAddress);
  if (!challengeId) throw new Error('challenge not found on chain');
  const participant = participantPda(new PublicKey(input.challengeAddress), new PublicKey(input.wallet));
  const program = createProgram(connection);
  const p = await program.account.participant.fetch(participant);
  const deposited = p.deposited.toString();

  const admin = createSupabaseAdminClient();
  const { error: memberError } = await admin.from('memberships').upsert(
    {
      challenge_id: challengeId,
      profile_id: input.profileId,
      wallet_address: input.wallet,
      participant_address: participant.toBase58(),
      deposited,
      status: enumVariant<'active' | 'survived' | 'failed' | 'voided'>(p.status),
      join_tx: input.signature,
      joined_at: iso(p.joinedAt.toNumber()),
    },
    { onConflict: 'challenge_id,profile_id' },
  );
  if (memberError) throw new Error(`membership sync failed: ${memberError.message}`);

  const { error: receiptError } = await admin.from('receipts').upsert(
    { challenge_id: challengeId, profile_id: input.profileId, wallet: input.wallet, kind: 'join', amount: deposited, tx_signature: input.signature },
    { onConflict: 'tx_signature', ignoreDuplicates: true },
  );
  if (receiptError) throw new Error(`receipt sync failed: ${receiptError.message}`);
}
