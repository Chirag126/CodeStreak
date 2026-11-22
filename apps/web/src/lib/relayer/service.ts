import 'server-only';

import { createHash } from 'node:crypto';
import { POOL_PARAM_MESSAGES, validatePoolParams, type PoolParams } from '@codestreak/shared';
import {
  anchor,
  associatedTokenAddress,
  challengePda,
  challengePhase,
  challengeTimes,
  configPda,
  createProgram,
  participantPda,
  PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  vaultPda,
  type ChallengeAccount,
} from '@codestreak/shared/program';
import { friendlyTxError } from '@codestreak/shared/errors';
import { buildCodestreakInstruction, checkRelayedTransaction, rateLimitDecision, type RelayedInstruction } from '@codestreak/shared/relayer';
import { ComputeBudgetProgram, Connection, PublicKey, SystemProgram, Transaction, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { syncChallenge, syncJoin } from '@/lib/sync/chain';
import { relayerKeypair } from './keypair';

/** Failures carry a plain-language message plus a stable code and headline for the UI. */
export type RelayResult<T> = ({ ok: true } & T) | { ok: false; error: string; code?: string; title?: string };

const COMPUTE_UNITS = 150_000;
const PRIORITY_MICRO_LAMPORTS = 1_000;
const MIN_RELAYER_LAMPORTS = 20_000_000; // 0.02 SOL: stop sponsoring before the relayer runs dry

export function serverConnection(): Connection {
  return new Connection(process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com', 'confirmed');
}

const messageHash = (tx: Transaction) => createHash('sha256').update(tx.serializeMessage()).digest('hex');

function failure(err: unknown, logs?: readonly string[] | null) {
  const f = friendlyTxError(err, logs);
  return { ok: false as const, error: f.message, code: f.code, title: f.title };
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

type RelayKind = 'join' | 'create';
const KIND_INSTRUCTION: Record<RelayKind, RelayedInstruction> = { join: 'join_pool', create: 'initialize_pool' };

/** Looks up an existing request for this idempotency key (retries) or applies the rate limit (new requests). */
interface Prior {
  /** Final answer for this request (retry of a finished/ongoing one, or rate-limited). */
  done?: RelayResult<{ transaction: string } | { signature: string }>;
  /** An earlier, expired prepared row to reuse. */
  existing?: { id: string; status: string };
}

async function existingOrRateLimit(input: { profileId: string; idempotencyKey: string; wallet: string; challengeAddress: string }): Promise<Prior> {
  const admin = createSupabaseAdminClient();
  const { data: existing } = await admin
    .from('relayer_requests')
    .select('id, status, signature, prepared_tx, last_valid_block_height, wallet, challenge_address')
    .eq('profile_id', input.profileId)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();
  if (existing) {
    if (existing.wallet !== input.wallet || existing.challenge_address !== input.challengeAddress) {
      return { done: { ok: false as const, error: 'This request key was used for something else.' } };
    }
    if (existing.status === 'confirmed') return { done: { ok: true as const, signature: existing.signature as string } };
    if (existing.status === 'submitting') return { done: { ok: false as const, error: 'This request is already being submitted.' } };
    if (existing.status === 'prepared' && (await serverConnection().getBlockHeight('confirmed')) < Number(existing.last_valid_block_height)) {
      return { done: { ok: true as const, transaction: existing.prepared_tx as string } }; // same transaction for a retry
    }
    return { existing: { id: existing.id as string, status: existing.status as string } };
  }
  const limit = rateLimitDecision(await userCounts(input.profileId));
  if (!limit.ok) return { done: { ok: false as const, error: limit.message, code: 'relayer.rate_limited', title: 'Slow down' } };
  return {};
}

/**
 * Shared tail of every sponsored action: wrap the instruction with a server-set compute budget,
 * check the relayer policy (only this kind's instruction), simulate, pre-sign and store it under
 * the user's idempotency key. The user's wallet adds its signature in the browser; nothing else
 * may change.
 */
async function prepareRelayed(input: {
  profileId: string;
  wallet: string;
  challengeAddress: string;
  idempotencyKey: string;
  kind: RelayKind;
  instruction: TransactionInstruction;
  payload?: Record<string, unknown>;
  existingId?: string;
  existingStatus?: string;
}): Promise<RelayResult<{ transaction: string }>> {
  const admin = createSupabaseAdminClient();
  const connection = serverConnection();
  const relayer = relayerKeypair();
  const user = new PublicKey(input.wallet);

  if ((await connection.getBalance(relayer.publicKey)) < MIN_RELAYER_LAMPORTS) {
    return { ok: false, error: 'Sponsored transactions are paused (relayer is low on devnet SOL). Try later.', code: 'relayer.low_funds', title: 'Paused' };
  }
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: relayer.publicKey, blockhash, lastValidBlockHeight }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS }),
    input.instruction,
  );

  const policy = checkRelayedTransaction(tx, { relayer: relayer.publicKey, user, programId: PROGRAM_ID, allowed: [KIND_INSTRUCTION[input.kind]] });
  if (!policy.ok) return { ok: false, error: `Refused: ${policy.errors.join('; ')}`, code: 'relayer.policy', title: 'Refused by the relayer' };

  const sim = await connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), { sigVerify: false });
  if (sim.value.err) return failure(sim.value.err, sim.value.logs);

  tx.partialSign(relayer);
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  const row = {
    kind: input.kind,
    challenge_address: input.challengeAddress,
    wallet: input.wallet,
    message_hash: messageHash(tx),
    prepared_tx: serialized,
    last_valid_block_height: lastValidBlockHeight,
    status: 'prepared' as const,
    error: null,
    payload: input.payload ?? {},
  };
  const { error } = input.existingId
    ? await admin.from('relayer_requests').update(row).eq('id', input.existingId).eq('status', input.existingStatus ?? 'prepared')
    : await admin.from('relayer_requests').insert({ ...row, profile_id: input.profileId, idempotency_key: input.idempotencyKey });
  if (error) return { ok: false, error: 'Could not save the request. Try again.' };
  return { ok: true, transaction: serialized };
}

async function chainNow(connection: Connection): Promise<number> {
  const slot = await connection.getSlot('confirmed');
  return (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
}

/** Sponsored join: the relayer pays fees and the Participant rent. */
export async function prepareJoin(input: {
  profileId: string;
  wallet: string;
  challengeAddress: string;
  idempotencyKey: string;
}): Promise<RelayResult<{ transaction: string } | { signature: string }>> {
  const prior = await existingOrRateLimit(input);
  if (prior.done) return prior.done;

  const connection = serverConnection();
  const relayer = relayerKeypair();
  const user = new PublicKey(input.wallet);
  const challengeKey = new PublicKey(input.challengeAddress);
  let challenge: ChallengeAccount;
  try {
    challenge = await createProgram(connection).account.challenge.fetch(challengeKey);
  } catch {
    return { ok: false, error: 'Challenge not found on devnet.' };
  }
  if (challengePhase(challengeTimes(challenge), await chainNow(connection)) !== 'joining') {
    return { ok: false, error: 'Joining has closed for this challenge.', code: 'program.JoinClosed', title: 'Joining is closed' };
  }
  const participant = participantPda(challengeKey, user);
  if (await connection.getAccountInfo(participant)) return { ok: false, error: 'This wallet already joined.', code: 'join.already', title: 'Already joined' };

  let joinAuthority: PublicKey | null = null;
  if (challenge.joinAuthority) {
    if (!challenge.joinAuthority.equals(relayer.publicKey)) return { ok: false, error: 'This private challenge is not managed by CodeStreak.' };
    if (!(await hasInvitation(input.profileId, input.challengeAddress))) {
      return { ok: false, error: 'This is a private group. You need an invitation to join.', code: 'program.JoinAuthorityRequired', title: 'Invitation needed' };
    }
    joinAuthority = relayer.publicKey; // co-sign only after the invitation check above
  }

  const userToken = associatedTokenAddress(user, challenge.mint, challenge.tokenProgram);
  const balance = await connection.getTokenAccountBalance(userToken).catch(() => null);
  if (!balance || BigInt(balance.value.amount) < BigInt(challenge.buyIn.toString())) {
    return { ok: false, error: 'Your wallet does not have enough tokens for the buy-in. Get devnet USDC from the faucet and try again.', code: 'token.insufficient_funds', title: 'Not enough tokens' };
  }

  return prepareRelayed({
    ...input,
    kind: 'join',
    existingId: prior.existing?.id,
    existingStatus: prior.existing?.status,
    instruction: buildCodestreakInstruction('join_pool', {
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
  });
}

/** Details stored with a create request and written to the challenges row once it confirms. */
export interface ChallengeDetails {
  title: string;
  description: string;
  visibility: 'public' | 'private';
  rules: Record<string, unknown>;
}

/**
 * Sponsored challenge creation: the user's linked wallet is the on-chain creator; the relayer pays
 * the rent for the Challenge and vault accounts. Private challenges name the relayer as their join
 * authority, so it co-signs joins only after checking invitations.
 */
export async function prepareCreate(input: {
  profileId: string;
  wallet: string;
  idempotencyKey: string;
  challengeId: bigint;
  params: PoolParams;
  mint: string;
  rulesHash: number[];
  details: ChallengeDetails;
}): Promise<RelayResult<{ transaction: string; challenge: string } | { signature: string; challenge: string }>> {
  const connection = serverConnection();
  const relayer = relayerKeypair();
  const creator = new PublicKey(input.wallet);
  const challengeKey = challengePda(creator, input.challengeId);
  const challengeAddress = challengeKey.toBase58();

  const prior = await existingOrRateLimit({ ...input, challengeAddress });
  if (prior.done) return prior.done.ok ? { ...prior.done, challenge: challengeAddress } : prior.done;

  const now = await chainNow(connection);
  const problem = validatePoolParams(input.params, now);
  if (problem) return { ok: false, error: POOL_PARAM_MESSAGES[problem].message, code: `program.${problem}`, title: 'Check the challenge settings' };

  const p = input.params;
  const program = createProgram(connection);
  const instruction = await program.methods
    .initializePool({
      challengeId: new anchor.BN(input.challengeId.toString()),
      buyIn: new anchor.BN(p.buyIn.toString()),
      startTs: new anchor.BN(p.startTs),
      dayLengthSecs: p.dayLengthSecs,
      numDays: p.numDays,
      joinDeadlineTs: new anchor.BN(p.joinDeadlineTs),
      minParticipants: p.minParticipants,
      maxParticipants: p.maxParticipants,
      shieldPrice: new anchor.BN(p.shieldPrice.toString()),
      maxShieldsPerParticipant: p.maxShieldsPerParticipant,
      shieldGraceSecs: p.shieldGraceSecs,
      verifyWindowSecs: p.verifyWindowSecs,
      disputeWindowSecs: p.disputeWindowSecs,
      joinAuthority: input.details.visibility === 'private' ? relayer.publicKey : null,
      rulesHash: input.rulesHash,
    })
    .accountsPartial({
      payer: relayer.publicKey,
      creator,
      config: configPda(),
      challenge: challengeKey,
      mint: new PublicKey(input.mint),
      vault: vaultPda(challengeKey),
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const prepared = await prepareRelayed({
    profileId: input.profileId,
    wallet: input.wallet,
    challengeAddress,
    idempotencyKey: input.idempotencyKey,
    kind: 'create',
    instruction,
    payload: { ...input.details },
    existingId: prior.existing?.id,
    existingStatus: prior.existing?.status,
  });
  return prepared.ok ? { ...prepared, challenge: challengeAddress } : prepared;
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
    .select('id, kind, status, signature, message_hash, wallet, challenge_address, last_valid_block_height, payload')
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
  const kind = row.kind as RelayKind;
  if (!(kind in KIND_INSTRUCTION)) return { ok: false, error: 'Unsupported request.' };
  const policy = checkRelayedTransaction(tx, { relayer: relayer.publicKey, user, programId: PROGRAM_ID, allowed: [KIND_INSTRUCTION[kind]] });
  if (!policy.ok) return { ok: false, error: `Refused: ${policy.errors.join('; ')}`, code: 'relayer.policy', title: 'Refused by the relayer' };
  if (!tx.verifySignatures(true)) return { ok: false, error: 'Missing or invalid signature.' };
  if ((await connection.getBlockHeight('confirmed')) >= Number(row.last_valid_block_height)) {
    return { ok: false, error: 'The transaction expired. Start again.' };
  }

  // Claim the request: a concurrent retry finds it no longer "prepared".
  const { data: claimed } = await admin.from('relayer_requests').update({ status: 'submitting' }).eq('id', row.id).eq('status', 'prepared').select('id');
  if (!claimed?.length) return { ok: false, error: 'This request was already submitted.' };

  const fail = async (err: unknown, logs?: readonly string[] | null) => {
    const f = failure(err, logs);
    await admin.from('relayer_requests').update({ status: 'failed', error: `${f.code}: ${f.error}`.slice(0, 500) }).eq('id', row.id);
    return f;
  };

  const raw = tx.serialize();
  const sim = await connection.simulateTransaction(VersionedTransaction.deserialize(raw), { sigVerify: true });
  if (sim.value.err) return fail(sim.value.err, sim.value.logs);

  let signature: string;
  try {
    signature = await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 3 });
    const confirmation = await connection.confirmTransaction(
      { signature, blockhash: tx.recentBlockhash!, lastValidBlockHeight: Number(row.last_valid_block_height) },
      'confirmed',
    );
    if (confirmation.value.err) return fail(confirmation.value.err);
  } catch (e) {
    return fail(e, (e as { logs?: string[] }).logs);
  }

  await admin.from('relayer_requests').update({ status: 'confirmed', signature, error: null }).eq('id', row.id);

  // Mirror the result into the app tables. The chain is already final, so a sync failure is logged
  // and retried on the next sync, never reported as a failed join.
  const mirror =
    kind === 'join'
      ? syncJoin(connection, { challengeAddress: row.challenge_address as string, wallet: row.wallet as string, profileId: input.profileId, signature })
      : syncChallenge(connection, row.challenge_address as string, { ...(row.payload as ChallengeDetails), creatorId: input.profileId, createTx: signature });
  await Promise.resolve(mirror).catch((e: unknown) => console.error(`[sync] ${kind} mirror failed:`, e instanceof Error ? e.message : e));

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
