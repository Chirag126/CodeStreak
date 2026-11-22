import 'server-only';

import { createHash } from 'node:crypto';
import {
  associatedTokenAddress,
  challengePhase,
  challengeTimes,
  createProgram,
  participantPda,
  PROGRAM_ID,
  vaultPda,
  type ChallengeAccount,
} from '@codestreak/shared/program';
import { buildCodestreakInstruction, checkRelayedTransaction, rateLimitDecision } from '@codestreak/shared/relayer';
import { ComputeBudgetProgram, Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { relayerKeypair } from './keypair';

export type RelayResult<T> = ({ ok: true } & T) | { ok: false; error: string };

const COMPUTE_UNITS = 150_000;
const PRIORITY_MICRO_LAMPORTS = 1_000;
const MIN_RELAYER_LAMPORTS = 20_000_000; // 0.02 SOL: stop sponsoring before the relayer runs dry

export function serverConnection(): Connection {
  return new Connection(process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com', 'confirmed');
}

const messageHash = (tx: Transaction) => createHash('sha256').update(tx.serializeMessage()).digest('hex');

function simulationError(logs: string[] | null | undefined, err: unknown): string {
  const anchor = logs?.find((l) => l.includes('Error Message:'))?.split('Error Message:')[1]?.trim();
  return anchor ? `The program rejected it: ${anchor}` : `Simulation failed: ${JSON.stringify(err)}`;
}

async function userCounts(profileId: string) {
  const admin = createSupabaseAdminClient();
  const since = (ms: number) => new Date(Date.now() - ms).toISOString();
  const count = async (from: string) => {
    const { count: n } = await admin.from('relayer_requests').select('id', { count: 'exact', head: true }).eq('profile_id', profileId).gte('created_at', from);
    return n ?? 0;
  };
  return { lastTenMinutes: await count(since(10 * 60_000)), lastDay: await count(since(24 * 3600_000)) };
}

/** Can this user join this private challenge? Requires a pending/accepted invitation in the database. */
async function hasInvitation(profileId: string, challengeAddress: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data: challenge } = await admin.from('challenges').select('id').eq('onchain_address', challengeAddress).maybeSingle();
  if (!challenge) return false;
  const { count } = await admin
    .from('invitations')
    .select('id', { count: 'exact', head: true })
    .eq('challenge_id', challenge.id)
    .eq('invitee_id', profileId)
    .in('status', ['pending', 'accepted']);
  return Boolean(count);
}

/**
 * Builds a join transaction the relayer pays for (fees + Participant rent), checks it against the
 * relayer policy, simulates it, pre-signs it and stores it under the user's idempotency key. The
 * user's wallet adds its signature in the browser; nothing else may change.
 */
export async function prepareJoin(input: {
  profileId: string;
  wallet: string;
  challengeAddress: string;
  idempotencyKey: string;
}): Promise<RelayResult<{ transaction: string } | { signature: string }>> {
  const admin = createSupabaseAdminClient();
  const connection = serverConnection();
  const relayer = relayerKeypair();

  const { data: existing } = await admin
    .from('relayer_requests')
    .select('id, status, signature, prepared_tx, last_valid_block_height, wallet, challenge_address')
    .eq('profile_id', input.profileId)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();
  if (existing) {
    if (existing.wallet !== input.wallet || existing.challenge_address !== input.challengeAddress) {
      return { ok: false, error: 'This request key was used for something else.' };
    }
    if (existing.status === 'confirmed') return { ok: true, signature: existing.signature as string };
    if (existing.status === 'submitting') return { ok: false, error: 'This join is already being submitted.' };
    if (existing.status === 'prepared' && (await connection.getBlockHeight('confirmed')) < Number(existing.last_valid_block_height)) {
      return { ok: true, transaction: existing.prepared_tx as string }; // same transaction for a retry
    }
  } else {
    const limit = rateLimitDecision(await userCounts(input.profileId));
    if (!limit.ok) return { ok: false, error: limit.message };
  }

  const user = new PublicKey(input.wallet);
  const challengeKey = new PublicKey(input.challengeAddress);
  const program = createProgram(connection);
  let challenge: ChallengeAccount;
  try {
    challenge = await program.account.challenge.fetch(challengeKey);
  } catch {
    return { ok: false, error: 'Challenge not found on devnet.' };
  }
  const slot = await connection.getSlot('confirmed');
  const chainTime = (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
  if (challengePhase(challengeTimes(challenge), chainTime) !== 'joining') return { ok: false, error: 'Joining is closed for this challenge.' };
  const participant = participantPda(challengeKey, user);
  if (await connection.getAccountInfo(participant)) return { ok: false, error: 'This wallet already joined.' };

  let joinAuthority: PublicKey | null = null;
  if (challenge.joinAuthority) {
    if (!challenge.joinAuthority.equals(relayer.publicKey)) return { ok: false, error: 'This private challenge is not managed by CodeStreak.' };
    if (!(await hasInvitation(input.profileId, input.challengeAddress))) return { ok: false, error: 'This is a private group: you need an invitation.' };
    joinAuthority = relayer.publicKey; // co-sign only after the invitation check above
  }

  const userToken = associatedTokenAddress(user, challenge.mint, challenge.tokenProgram);
  const balance = await connection.getTokenAccountBalance(userToken).catch(() => null);
  if (!balance || BigInt(balance.value.amount) < BigInt(challenge.buyIn.toString())) {
    return { ok: false, error: 'Not enough tokens in your wallet for the buy-in (get devnet USDC from the faucet).' };
  }
  if ((await connection.getBalance(relayer.publicKey)) < MIN_RELAYER_LAMPORTS) {
    return { ok: false, error: 'Sponsored transactions are paused (relayer is low on devnet SOL). Try later.' };
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: relayer.publicKey, blockhash, lastValidBlockHeight }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS }),
    buildCodestreakInstruction('join_pool', {
      payer: relayer.publicKey,
      user,
      join_authority: joinAuthority,
      challenge: challengeKey,
      participant,
      mint: challenge.mint,
      user_token: userToken,
      vault: vaultPda(challengeKey),
      token_program: challenge.tokenProgram,
    }),
  );

  const policy = checkRelayedTransaction(tx, { relayer: relayer.publicKey, user, programId: PROGRAM_ID, allowed: ['join_pool'] });
  if (!policy.ok) return { ok: false, error: `Refused: ${policy.errors.join('; ')}` };

  const sim = await connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), { sigVerify: false });
  if (sim.value.err) return { ok: false, error: simulationError(sim.value.logs, sim.value.err) };

  tx.partialSign(relayer);
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  const row = {
    kind: 'join' as const,
    challenge_address: input.challengeAddress,
    wallet: input.wallet,
    message_hash: messageHash(tx),
    prepared_tx: serialized,
    last_valid_block_height: lastValidBlockHeight,
    status: 'prepared' as const,
    error: null,
  };
  const { error } = existing
    ? await admin.from('relayer_requests').update(row).eq('id', existing.id).eq('status', existing.status)
    : await admin.from('relayer_requests').insert({ ...row, profile_id: input.profileId, idempotency_key: input.idempotencyKey });
  if (error) return { ok: false, error: 'Could not save the request. Try again.' };
  return { ok: true, transaction: serialized };
}

/**
 * Accepts the user-signed transaction only if it is byte-for-byte the message the relayer signed
 * (so nothing, e.g. an extra transfer, was added), still passes the policy, every signature is
 * valid and simulation succeeds. Then sends it once and records the result.
 */
export async function submitRelayed(input: { profileId: string; idempotencyKey: string; signedTransaction: string }): Promise<RelayResult<{ signature: string }>> {
  const admin = createSupabaseAdminClient();
  const connection = serverConnection();
  const relayer = relayerKeypair();

  const { data: row } = await admin
    .from('relayer_requests')
    .select('id, kind, status, signature, message_hash, wallet, challenge_address, last_valid_block_height')
    .eq('profile_id', input.profileId)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();
  if (!row) return { ok: false, error: 'Request not found. Start again.' };
  if (row.status === 'confirmed') return { ok: true, signature: row.signature as string };
  if (row.status !== 'prepared') return { ok: false, error: 'This request was already submitted.' };

  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(input.signedTransaction, 'base64'));
  } catch {
    return { ok: false, error: 'Could not read the signed transaction.' };
  }
  if (messageHash(tx) !== row.message_hash) return { ok: false, error: 'Refused: the transaction was changed after it was prepared.' };
  const user = new PublicKey(row.wallet as string);
  const policy = checkRelayedTransaction(tx, { relayer: relayer.publicKey, user, programId: PROGRAM_ID, allowed: ['join_pool'] });
  if (!policy.ok) return { ok: false, error: `Refused: ${policy.errors.join('; ')}` };
  if (!tx.verifySignatures(true)) return { ok: false, error: 'Missing or invalid signature.' };
  if ((await connection.getBlockHeight('confirmed')) >= Number(row.last_valid_block_height)) {
    return { ok: false, error: 'The transaction expired. Start again.' };
  }

  // Claim the request: a concurrent retry finds it no longer "prepared".
  const { data: claimed } = await admin.from('relayer_requests').update({ status: 'submitting' }).eq('id', row.id).eq('status', 'prepared').select('id');
  if (!claimed?.length) return { ok: false, error: 'This request was already submitted.' };

  const fail = async (message: string) => {
    await admin.from('relayer_requests').update({ status: 'failed', error: message.slice(0, 500) }).eq('id', row.id);
    return { ok: false as const, error: message };
  };

  const raw = tx.serialize();
  const sim = await connection.simulateTransaction(VersionedTransaction.deserialize(raw), { sigVerify: true });
  if (sim.value.err) return fail(simulationError(sim.value.logs, sim.value.err));

  let signature: string;
  try {
    signature = await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 3 });
    const confirmation = await connection.confirmTransaction(
      { signature, blockhash: tx.recentBlockhash!, lastValidBlockHeight: Number(row.last_valid_block_height) },
      'confirmed',
    );
    if (confirmation.value.err) return fail(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Sending failed.');
  }

  await admin.from('relayer_requests').update({ status: 'confirmed', signature, error: null }).eq('id', row.id);
  await admin.from('audit_log').insert({
    actor_kind: 'relayer',
    actor_id: input.profileId,
    action: `relayer.${row.kind as string}`,
    entity_type: 'challenge',
    entity_id: row.challenge_address as string,
    details: { signature, wallet: row.wallet },
  });
  return { ok: true, signature };
}
