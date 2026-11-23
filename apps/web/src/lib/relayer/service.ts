import 'server-only';

import { createHash } from 'node:crypto';
import { formatAmount, missingProviders, PROVIDER_LABELS, parseSponsorAmount, POOL_PARAM_MESSAGES, SOL_DECIMALS, USDC_DECIMALS, validatePoolParams, type PoolParams } from '@codestreak/shared';
import {
  anchor,
  associatedTokenAddress,
  challengePda,
  challengePhase,
  challengeTimes,
  configPda,
  createProgram,
  rulesHash,
  participantPda,
  PROGRAM_ID,
  sponsorReceiptPda,
  TOKEN_PROGRAM_ID,
  vaultPda,
  type ChallengeAccount,
} from '@codestreak/shared/program';
import { friendlyTxError } from '@codestreak/shared/errors';
import {
  buildCodestreakInstruction,
  checkRelayedTransaction,
  closeWrappedSolAccountInstruction,
  createWrappedSolAccountInstruction,
  planSolWrap,
  rateLimitDecision,
  wrapSolInstructions,
  WSOL_MINT_KEY,
  type RelayedInstruction,
  type WrapContext,
} from '@codestreak/shared/relayer';
import { ComputeBudgetProgram, Connection, PublicKey, SystemProgram, Transaction, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { linkedProviders } from '@/lib/accounts/github';
import { syncChallenge, syncJoin, syncSponsor } from '@/lib/sync/chain';
import { relayerKeypair } from './keypair';

/** Failures carry a plain-language message plus a stable code and headline for the UI. */
export type RelayResult<T> = ({ ok: true } & T) | { ok: false; error: string; code?: string; title?: string };

const COMPUTE_UNITS = 150_000;
const COMPUTE_UNITS_WITH_WRAP = 200_000;
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
/** Who may join a private group: its creator, or someone with a live (pending or accepted) invitation. */
async function mayJoinPrivate(profileId: string, challengeAddress: string): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data: challenge } = await admin.from('challenges').select('id, creator_id').eq('onchain_address', challengeAddress).maybeSingle();
  if (!challenge) return false;
  if (challenge.creator_id === profileId) return true;
  const { count } = await admin
    .from('invitations')
    .select('id', { count: 'exact', head: true })
    .eq('challenge_id', challenge.id)
    .eq('invitee_id', profileId)
    .in('status', ['pending', 'accepted']);
  return Boolean(count);
}

/** True when the rules document CodeStreak shows hashes to the challenge's on-chain fingerprint. */
export async function rulesMatchChain(challengeAddress: string, onChainHashHex: string): Promise<boolean> {
  const { data } = await createSupabaseAdminClient().from('challenges').select('rules').eq('onchain_address', challengeAddress).maybeSingle();
  if (!data?.rules) return false;
  return Buffer.from(await rulesHash(data.rules)).toString('hex') === onChainHashHex;
}

/** Providers that can be linked today; the others are not required yet (LeetCode linking comes later). */
const LINKABLE = new Set(['github']);

/** A message if the challenge's rules need accounts the profile hasn't linked, else null. */
async function joinRequirement(profileId: string, challengeAddress: string): Promise<string | null> {
  const { data } = await createSupabaseAdminClient().from('challenges').select('rules').eq('onchain_address', challengeAddress).maybeSingle();
  const rules = (data?.rules ?? null) as { providers?: ('github' | 'leetcode')[]; providerRule?: 'any' | 'all' } | null;
  const linked = await linkedProviders(profileId);
  const notYetLinkable = (rules?.providers ?? []).filter((p) => !LINKABLE.has(p));
  const check = missingProviders(rules, [...linked, ...notYetLinkable]);
  if (check.ok) return null;
  if (check.rule === 'all') {
    return `This challenge counts ${check.need.map((p) => PROVIDER_LABELS[p]).join(' and ')} activity, and your ${check.need.map((p) => PROVIDER_LABELS[p]).join(' and ')} account isn't linked yet. Link it in Dashboard → Settings, then join.`;
  }
  return `This challenge counts ${check.need.map((p) => PROVIDER_LABELS[p]).join(' or ')} activity, and you haven't linked any of them yet. Link GitHub in Dashboard → Settings, then join.`;
}

/** Joining a private group answers its pending invitation. */
async function acceptInvitationOnJoin(profileId: string, challengeAddress: string) {
  const admin = createSupabaseAdminClient();
  const { data: challenge } = await admin.from('challenges').select('id').eq('onchain_address', challengeAddress).maybeSingle();
  if (!challenge) return;
  await admin
    .from('invitations')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('challenge_id', challenge.id)
    .eq('invitee_id', profileId)
    .eq('status', 'pending');
}

type RelayKind = 'join' | 'create' | 'sponsor';
const KIND_INSTRUCTION: Record<RelayKind, RelayedInstruction> = { join: 'join_pool', create: 'initialize_pool', sponsor: 'sponsor_pool' };

export const hashSponsorToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

/**
 * Who may sponsor a private group: people who can see it (creator, members, live invitees) or
 * anyone holding its current sponsor link. Public challenges: anyone signed in.
 */
async function maySponsorPrivate(profileId: string, challengeAddress: string, sponsorToken: string | undefined): Promise<boolean> {
  const admin = createSupabaseAdminClient();
  const { data: c } = await admin.from('challenges').select('id, creator_id, sponsor_link_hash').eq('onchain_address', challengeAddress).maybeSingle();
  if (!c) return false;
  if (sponsorToken && c.sponsor_link_hash && hashSponsorToken(sponsorToken) === c.sponsor_link_hash) return true;
  if (c.creator_id === profileId) return true;
  const [{ count: member }, { count: invited }] = await Promise.all([
    admin.from('memberships').select('id', { count: 'exact', head: true }).eq('challenge_id', c.id).eq('profile_id', profileId),
    admin.from('invitations').select('id', { count: 'exact', head: true }).eq('challenge_id', c.id).eq('invitee_id', profileId).in('status', ['pending', 'accepted']),
  ]);
  return Boolean(member || invited);
}

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
  instructions: TransactionInstruction[];
  /** SOL stakes: the wrap instructions allowed around the join. */
  wrap?: WrapContext;
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
    ComputeBudgetProgram.setComputeUnitLimit({ units: input.wrap ? COMPUTE_UNITS_WITH_WRAP : COMPUTE_UNITS }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICRO_LAMPORTS }),
    ...input.instructions,
  );

  const policy = checkRelayedTransaction(tx, { relayer: relayer.publicKey, user, programId: PROGRAM_ID, allowed: [KIND_INSTRUCTION[input.kind]], wrap: input.wrap });
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
    // The wrap context is the server's own decision; kept so submit applies the same policy.
    payload: { ...(input.payload ?? {}), ...(input.wrap ? { wrap: { account: input.wrap.account.toBase58(), maxLamports: input.wrap.maxLamports.toString() } } : {}) },
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
  /** The on-chain rules fingerprint (hex) of the rules the user read and accepted. */
  acknowledgedRulesHash: string;
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

  // Consent is bound to the exact rules: the user's accepted fingerprint must be the on-chain one,
  // and the rules CodeStreak shows must hash to it (otherwise nobody can see what they'd agree to).
  const onChainHash = Buffer.from(challenge.rulesHash).toString('hex');
  if (input.acknowledgedRulesHash !== onChainHash) {
    return { ok: false, code: 'rules.changed', title: 'Read the rules again', error: 'These are not the rules you accepted. Reload the page, read the rules again and confirm.' };
  }
  if (!(await rulesMatchChain(input.challengeAddress, onChainHash))) {
    return {
      ok: false,
      code: 'rules.unverified',
      title: "Rules can't be verified",
      error: "The rules saved for this challenge don't match its on-chain fingerprint, so CodeStreak can't show you what you would agree to. Joining is blocked.",
    };
  }

  const participant = participantPda(challengeKey, user);
  if (await connection.getAccountInfo(participant)) return { ok: false, error: 'This wallet already joined.', code: 'join.already', title: 'Already joined' };

  let joinAuthority: PublicKey | null = null;
  if (challenge.joinAuthority) {
    if (!challenge.joinAuthority.equals(relayer.publicKey)) return { ok: false, error: 'This private challenge is not managed by CodeStreak.' };
    if (!(await mayJoinPrivate(input.profileId, input.challengeAddress))) {
      return { ok: false, error: 'This is a private group. You need an invitation to join.', code: 'program.JoinAuthorityRequired', title: 'Invitation needed' };
    }
    joinAuthority = relayer.publicKey; // co-sign only after the invitation check above
  }

  if (challenge.participantCount >= challenge.maxParticipants) {
    return { ok: false, error: 'This challenge is full.', code: 'program.PoolFull', title: 'Challenge full' };
  }

  // The rules' providers must be linked before joining (otherwise days could never be verified).
  const requirement = await joinRequirement(input.profileId, input.challengeAddress);
  if (requirement) return { ok: false, error: requirement, code: 'account.not_linked', title: 'Link your accounts first' };

  const buyIn = BigInt(challenge.buyIn.toString());
  const userToken = associatedTokenAddress(user, challenge.mint, challenge.tokenProgram);
  const joinIx = buildCodestreakInstruction('join_pool', {
    payer: relayer.publicKey,
    user,
    join_authority: joinAuthority,
    challenge: challengeKey,
    participant,
    mint: challenge.mint,
    user_token: userToken,
    vault: vaultPda(challengeKey),
    token_program: challenge.tokenProgram,
  });
  const common = { ...input, kind: 'join' as const, existingId: prior.existing?.id, existingStatus: prior.existing?.status };

  if (!challenge.mint.equals(WSOL_MINT_KEY)) {
    // Token stake (USDC): the user's token account must hold the buy-in.
    const balance = await connection.getTokenAccountBalance(userToken).catch(() => null);
    const have = balance ? BigInt(balance.value.amount) : 0n;
    if (have < buyIn) {
      return {
        ok: false,
        code: 'token.insufficient_funds',
        title: 'Not enough USDC',
        error: `The buy-in is ${formatAmount(buyIn, USDC_DECIMALS)} USDC and your wallet has ${formatAmount(have, USDC_DECIMALS)}. Get devnet USDC from faucet.circle.com (Solana Devnet) and try again.`,
      };
    }
    return prepareRelayed({ ...common, instructions: [joinIx] });
  }

  // SOL stake: wrap exactly what's missing in the same transaction, then close the wSOL account
  // again if we created it (its rent goes back to the user). The user pays only the stake.
  const existing = await connection.getAccountInfo(userToken);
  const plan = planSolWrap({
    buyIn,
    accountExists: Boolean(existing),
    wrappedBalance: existing ? BigInt((await connection.getTokenAccountBalance(userToken)).value.amount) : 0n,
    accountRent: existing ? 0n : BigInt(await connection.getMinimumBalanceForRentExemption(165)),
    solBalance: BigInt(await connection.getBalance(user)),
  });
  if (!plan.enough) {
    return {
      ok: false,
      code: 'sol.insufficient',
      title: 'Not enough SOL',
      error: `You need ${formatAmount(plan.required, SOL_DECIMALS)} SOL (the ${formatAmount(buyIn, SOL_DECIMALS)} SOL stake${plan.createAccount ? ' plus a small deposit you get back' : ''}). Get devnet SOL from faucet.solana.com and try again.`,
    };
  }
  const instructions = [
    ...(plan.createAccount ? [createWrappedSolAccountInstruction(user, userToken)] : []),
    ...(plan.toWrap > 0n ? wrapSolInstructions(user, userToken, plan.toWrap) : []),
    joinIx,
    ...(plan.createAccount ? [closeWrappedSolAccountInstruction(user, userToken)] : []),
  ];
  return prepareRelayed({ ...common, instructions, wrap: { account: userToken, maxLamports: buyIn } });
}

/**
 * Sponsored sponsorship: the sponsor adds `amount` to the reward pool without joining; the relayer
 * pays the fees and (first time) the SponsorReceipt rent. Private pools need the relayer's
 * co-signature, given only to people who may see the group or hold its sponsor link.
 */
export async function prepareSponsor(input: {
  profileId: string;
  wallet: string;
  challengeAddress: string;
  idempotencyKey: string;
  amount: string;
  message: string | null;
  sponsorToken?: string;
}): Promise<RelayResult<{ transaction: string } | { signature: string }>> {
  const prior = await existingOrRateLimit(input);
  if (prior.done) return prior.done;

  const connection = serverConnection();
  const relayer = relayerKeypair();
  const sponsor = new PublicKey(input.wallet);
  const challengeKey = new PublicKey(input.challengeAddress);
  let challenge: ChallengeAccount;
  try {
    challenge = await createProgram(connection).account.challenge.fetch(challengeKey);
  } catch {
    return { ok: false, error: 'Challenge not found on devnet.' };
  }
  const phase = challengePhase(challengeTimes(challenge), await chainNow(connection));
  if (phase !== 'joining' && phase !== 'starting' && phase !== 'active') {
    return { ok: false, error: 'Sponsorship closes when the challenge ends.', code: 'program.SponsorshipClosed', title: 'Sponsorship closed' };
  }

  const isSol = challenge.mint.equals(WSOL_MINT_KEY);
  const token = isSol ? 'sol' : 'usdc';
  const parsed = parseSponsorAmount(input.amount, token);
  if (!parsed.ok) return { ok: false, error: parsed.error, code: 'sponsor.amount', title: 'Check the amount' };
  const amount = parsed.amount;

  let joinAuthority: PublicKey | null = null;
  if (challenge.joinAuthority) {
    if (!challenge.joinAuthority.equals(relayer.publicKey)) return { ok: false, error: 'This private challenge is not managed by CodeStreak.' };
    if (!(await maySponsorPrivate(input.profileId, input.challengeAddress, input.sponsorToken))) {
      return { ok: false, error: "This is a private group. Sponsor it through the group's sponsor link.", code: 'program.JoinAuthorityRequired', title: 'Sponsor link needed' };
    }
    joinAuthority = relayer.publicKey; // co-sign only after the check above
  }

  const sponsorToken = associatedTokenAddress(sponsor, challenge.mint, challenge.tokenProgram);
  const receipt = sponsorReceiptPda(challengeKey, sponsor);
  const sponsorIx = buildCodestreakInstruction('sponsor_pool', {
    payer: relayer.publicKey,
    sponsor,
    join_authority: joinAuthority,
    challenge: challengeKey,
    receipt,
    mint: challenge.mint,
    sponsor_token: sponsorToken,
    vault: vaultPda(challengeKey),
    token_program: challenge.tokenProgram,
    system_program: SystemProgram.programId,
  }, { amount });
  const common = {
    ...input,
    kind: 'sponsor' as const,
    existingId: prior.existing?.id,
    existingStatus: prior.existing?.status,
    payload: { amount: amount.toString(), message: input.message, receipt: receipt.toBase58() },
  };

  if (!isSol) {
    const balance = await connection.getTokenAccountBalance(sponsorToken).catch(() => null);
    const have = balance ? BigInt(balance.value.amount) : 0n;
    if (have < amount) {
      return {
        ok: false,
        code: 'token.insufficient_funds',
        title: 'Not enough USDC',
        error: `You are sponsoring ${formatAmount(amount, USDC_DECIMALS)} USDC and your wallet has ${formatAmount(have, USDC_DECIMALS)}. Get devnet USDC from faucet.circle.com (Solana Devnet).`,
      };
    }
    return prepareRelayed({ ...common, instructions: [sponsorIx] });
  }

  const existing = await connection.getAccountInfo(sponsorToken);
  const plan = planSolWrap({
    buyIn: amount,
    accountExists: Boolean(existing),
    wrappedBalance: existing ? BigInt((await connection.getTokenAccountBalance(sponsorToken)).value.amount) : 0n,
    accountRent: existing ? 0n : BigInt(await connection.getMinimumBalanceForRentExemption(165)),
    solBalance: BigInt(await connection.getBalance(sponsor)),
  });
  if (!plan.enough) {
    return {
      ok: false,
      code: 'sol.insufficient',
      title: 'Not enough SOL',
      error: `You need ${formatAmount(plan.required, SOL_DECIMALS)} SOL (the ${formatAmount(amount, SOL_DECIMALS)} SOL sponsorship${plan.createAccount ? ' plus a small deposit you get back' : ''}). Get devnet SOL from faucet.solana.com.`,
    };
  }
  const instructions = [
    ...(plan.createAccount ? [createWrappedSolAccountInstruction(sponsor, sponsorToken)] : []),
    ...(plan.toWrap > 0n ? wrapSolInstructions(sponsor, sponsorToken, plan.toWrap) : []),
    sponsorIx,
    ...(plan.createAccount ? [closeWrappedSolAccountInstruction(sponsor, sponsorToken)] : []),
  ];
  return prepareRelayed({ ...common, instructions, wrap: { account: sponsorToken, maxLamports: amount } });
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
    instructions: [instruction],
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
  const storedWrap = (row.payload as { wrap?: { account: string; maxLamports: string } } | null)?.wrap;
  const wrap = storedWrap ? { account: new PublicKey(storedWrap.account), maxLamports: BigInt(storedWrap.maxLamports) } : undefined;
  const policy = checkRelayedTransaction(tx, { relayer: relayer.publicKey, user, programId: PROGRAM_ID, allowed: [KIND_INSTRUCTION[kind]], wrap });
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
  const sponsorPayload = row.payload as { amount?: string; message?: string | null; receipt?: string } | null;
  const mirror =
    kind === 'join'
      ? syncJoin(connection, { challengeAddress: row.challenge_address as string, wallet: row.wallet as string, profileId: input.profileId, signature })
      : kind === 'sponsor'
        ? syncSponsor(connection, {
            challengeAddress: row.challenge_address as string,
            wallet: row.wallet as string,
            profileId: input.profileId,
            signature,
            amount: sponsorPayload?.amount ?? '0',
            message: sponsorPayload?.message ?? null,
            receipt: sponsorPayload?.receipt ?? null,
          })
        : syncChallenge(connection, row.challenge_address as string, { ...(row.payload as ChallengeDetails), creatorId: input.profileId, createTx: signature });
  await Promise.resolve(mirror).catch((e: unknown) => console.error(`[sync] ${kind} mirror failed:`, e instanceof Error ? e.message : e));
  if (kind === 'join') await acceptInvitationOnJoin(input.profileId, row.challenge_address as string);

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
