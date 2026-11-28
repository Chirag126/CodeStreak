import 'server-only';

import { challengeMirrorRow, createProgram, enumVariant, participantPda } from '@codestreak/shared/program';
import { PublicKey, type Connection } from '@solana/web3.js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();

/**
 * Mirrors a challenge into `challenges` (insert on first sight, then refresh the mirrored fields).
 * Returns the row id, or null if the account doesn't exist.
 */
/** What only the app knows: set by the create wizard once the creation confirms. */
export interface ChallengeAppDetails {
  title: string;
  description: string;
  visibility: 'public' | 'private';
  rules: Record<string, unknown>;
  creatorId: string;
  createTx: string;
}

export async function syncChallenge(connection: Connection, address: string, details?: ChallengeAppDetails): Promise<string | null> {
  const program = createProgram(connection);
  const account = await program.account.challenge.fetchNullable(new PublicKey(address));
  if (!account) return null;
  const admin = createSupabaseAdminClient();
  const mirror = challengeMirrorRow(address, account);

  const appFields = details
    ? {
        title: details.title,
        description: details.description || null,
        rules: details.rules,
        creator_id: details.creatorId,
        create_tx: details.createTx,
      }
    : null;

  const { data: existing } = await admin.from('challenges').select('id').eq('onchain_address', address).maybeSingle();
  if (existing) {
    const { error } = await admin.from('challenges').update({ ...mirror, ...appFields }).eq('id', existing.id);
    if (error) throw new Error(`challenge sync failed: ${error.message}`);
    return existing.id as string;
  }

  // First sight: attribute it to the creator's profile if their wallet is linked.
  const { data: creatorWallet } = await admin.from('wallets').select('profile_id').eq('address', account.creator.toBase58()).maybeSingle();
  const { data: inserted, error } = await admin
    .from('challenges')
    .insert(
      appFields
        ? { ...mirror, ...appFields }
        : {
            ...mirror,
            creator_id: (creatorWallet?.profile_id as string | undefined) ?? null,
            title: `${account.isDemo ? 'Demo challenge' : 'Challenge'} ${address.slice(0, 4)}`,
            rules: { source: 'chain', note: 'Created outside the app; the on-chain rules hash is authoritative.' },
          },
    )
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

  const { error: receiptError } = await admin
    .from('receipts')
    .insert({ challenge_id: challengeId, profile_id: input.profileId, wallet: input.wallet, kind: 'join', amount: deposited, tx_signature: input.signature });
  if (receiptError && !alreadyRecorded(receiptError)) throw new Error(`receipt sync failed: ${receiptError.message}`);
}

/**
 * Mirrors every on-chain Participant of a challenge whose wallet is linked to a CodeStreak profile
 * (joins can happen outside the app). Existing rows keep their join transaction. Returns the count.
 */
export async function syncMembers(connection: Connection, challengeAddress: string): Promise<number> {
  const challengeId = await syncChallenge(connection, challengeAddress);
  if (!challengeId) return 0;
  const program = createProgram(connection);
  // Participant layout: 8-byte discriminator, then the challenge pubkey.
  const participants = await program.account.participant.all([{ memcmp: { offset: 8, bytes: challengeAddress } }]);
  if (!participants.length) return 0;

  const admin = createSupabaseAdminClient();
  const wallets = participants.map((p) => p.account.user.toBase58());
  const { data: linked } = await admin.from('wallets').select('address, profile_id').in('address', wallets);
  const profileOf = new Map((linked ?? []).map((w) => [w.address as string, w.profile_id as string]));

  const rows = participants
    .filter((p) => profileOf.has(p.account.user.toBase58()))
    .map((p) => ({
      challenge_id: challengeId,
      profile_id: profileOf.get(p.account.user.toBase58())!,
      wallet_address: p.account.user.toBase58(),
      participant_address: p.publicKey.toBase58(),
      deposited: p.account.deposited.toString(),
      status: enumVariant<'active' | 'survived' | 'failed' | 'voided'>(p.account.status),
      joined_at: iso(p.account.joinedAt.toNumber()),
    }));
  if (!rows.length) return 0;
  const { error } = await admin.from('memberships').upsert(rows, { onConflict: 'challenge_id,profile_id' });
  if (error) throw new Error(`member sync failed: ${error.message}`);
  return rows.length;
}

/**
 * Mirrors a confirmed sponsorship: totals from the chain (syncChallenge), then one sponsorships row
 * per transaction (the amount comes from the prepared transaction, which submit verified
 * byte-for-byte) and a receipt for the sponsor's history.
 */
export async function syncSponsor(
  connection: Connection,
  input: { challengeAddress: string; wallet: string; profileId: string; signature: string; amount: string; message: string | null; receipt: string | null },
): Promise<void> {
  const challengeId = await syncChallenge(connection, input.challengeAddress);
  if (!challengeId) throw new Error('challenge not found on chain');
  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('sponsorships').upsert(
    {
      challenge_id: challengeId,
      sponsor_id: input.profileId,
      sponsor_wallet: input.wallet,
      amount: input.amount,
      message: input.message,
      tx_signature: input.signature,
      receipt_address: input.receipt,
    },
    { onConflict: 'tx_signature', ignoreDuplicates: true },
  );
  if (error) throw new Error(`sponsorship sync failed: ${error.message}`);
  const { error: receiptError } = await admin
    .from('receipts')
    .insert({ challenge_id: challengeId, profile_id: input.profileId, wallet: input.wallet, kind: 'sponsor', amount: input.amount, tx_signature: input.signature });
  if (receiptError && !alreadyRecorded(receiptError)) throw new Error(`receipt sync failed: ${receiptError.message}`);
}

/** Mirrors a confirmed Shield: the shields row (board shows the day as covered), the receipt, the totals. */
export async function syncShield(connection: Connection, input: { challengeAddress: string; wallet: string; day: number; signature: string }): Promise<void> {
  const challengeId = await syncChallenge(connection, input.challengeAddress);
  if (!challengeId) throw new Error('challenge not found on chain');
  const program = createProgram(connection);
  const challengeKey = new PublicKey(input.challengeAddress);
  const [account, p] = await Promise.all([
    program.account.challenge.fetch(challengeKey),
    program.account.participant.fetch(participantPda(challengeKey, new PublicKey(input.wallet))),
  ]);
  if (!Number.isInteger(input.day) || !((BigInt(p.shieldedDays.toString()) >> BigInt(input.day)) & 1n)) throw new Error(`day ${input.day} is not shielded on-chain`);

  const admin = createSupabaseAdminClient();
  const { data: m } = await admin.from('memberships').select('id, profile_id').eq('challenge_id', challengeId).eq('wallet_address', input.wallet).maybeSingle();
  if (!m) throw new Error('membership not found');
  const price = account.shieldPrice.toString();
  const { error } = await admin
    .from('shields')
    .upsert({ membership_id: m.id, day: input.day, price_paid: price, tx_signature: input.signature }, { onConflict: 'membership_id,day', ignoreDuplicates: true });
  if (error) throw new Error(`shield sync failed: ${error.message}`);
  const { error: receiptError } = await admin
    .from('receipts')
    .insert({ challenge_id: challengeId, profile_id: m.profile_id, wallet: input.wallet, kind: 'shield', amount: price, tx_signature: input.signature });
  if (receiptError && !alreadyRecorded(receiptError)) throw new Error(`receipt sync failed: ${receiptError.message}`);
}

/** A receipt for this transaction is already there (a repeated sync): fine, it is recorded once. */
function alreadyRecorded(error: { code?: string }): boolean {
  return error.code === '23505';
}
