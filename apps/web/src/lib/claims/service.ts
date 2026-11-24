import 'server-only';

// Phase 30 - Claim center. Payouts are pushed automatically by the worker (Phase 28); this is the
// player's view of them and the fallback when the worker hasn't paid yet:
//   - loadClaimCenter : every challenge you played or sponsored, what the chain says you are owed or
//                       were paid, line by line, plus wrapped SOL waiting to be unwrapped;
//   - claimNow        : the server sends the claim itself (claims need no signature from you; the
//                       relayer pays the fee) after re-checking the chain;
//   - prepareUnwrap   : closes your wrapped SOL account into plain SOL (you sign as the owner).
// The chain decides everything: a claim before settlement, a second claim, or a claim to anyone but
// the owner's own token account is refused by the program; the server refuses them earlier with a
// plain reason, and a per-player lock stops two claims racing each other.
import { createHash } from 'node:crypto';
import { claimable, claimBlock, payoutBreakdown, type ClaimBlock, type ClaimChallenge, type ClaimParticipant } from '@codestreak/shared';
import {
  associatedTokenAddress,
  challengePhase,
  challengeTimes,
  createProgram,
  disputeEndTs,
  enumVariant,
  participantPda,
  sponsorReceiptPda,
  type ChallengeAccount,
  type ParticipantAccount,
} from '@codestreak/shared/program';
import { checkRelayedTransaction, checkUnwrapTransaction, closeWrappedSolAccountInstruction, rateLimitDecision, WSOL_MINT_KEY } from '@codestreak/shared/relayer';
import { ComputeBudgetProgram, PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction, type Connection } from '@solana/web3.js';
import { relayerKeypair } from '@/lib/relayer/keypair';
import { relayerUsage, serverConnection, type RelayResult } from '@/lib/relayer/service';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const MIN_RELAYER_LAMPORTS = 20_000_000;
/** A "submitting" claim older than this is treated as abandoned (its outcome is re-read from the chain). */
const STALE_CLAIM_MS = 2 * 60_000;

export type ClaimRole = 'player' | 'sponsor';

export interface ClaimLineView {
  label: string;
  amount: string;
  negative?: boolean;
  note?: string;
}

export interface ClaimRow {
  role: ClaimRole;
  challenge: string;
  title: string;
  token: 'sol' | 'usdc';
  /** What happened, in a word: Survived, Voided, Missed a day, Cancelled, Results pending… */
  outcome: string;
  /** Paid (on-chain claimed), claimable now, or why not. */
  state: 'paid' | 'claimable' | ClaimBlock;
  /** Plain-language reason when not claimable. */
  reason: string | null;
  /** Base units: owed now, or the amount paid. */
  amount: string;
  lines: ClaimLineView[];
  paidTx: string | null;
  /** Unix seconds: when the challenge can settle (dispute window end), for "not settled yet". */
  settlesAt: number | null;
}

export interface WrappedSolView {
  wallet: string;
  account: string;
  /** Lamports held as wrapped SOL (the payout); the account's rent comes back too when unwrapping. */
  amount: string;
}

export interface ClaimCenter {
  rows: ClaimRow[];
  wrapped: WrappedSolView[];
}

function claimChallenge(c: ChallengeAccount): ClaimChallenge {
  return {
    state: enumVariant<'open' | 'cancelled' | 'settled'>(c.state),
    fullRefund: c.fullRefund,
    buyIn: BigInt(c.buyIn.toString()),
    totalStake: BigInt(c.totalStake.toString()),
    totalSponsor: BigInt(c.totalSponsor.toString()),
    totalShield: BigInt(c.totalShield.toString()),
    survivorCount: c.survivorCount,
    voidedCount: c.voidedCount,
    rewardPerSurvivor: BigInt(c.rewardPerSurvivor.toString()),
    rewardDust: BigInt(c.rewardDust.toString()),
    survivorsClaimed: c.survivorsClaimed,
  };
}

function claimParticipant(p: ParticipantAccount): ClaimParticipant {
  return {
    deposited: BigInt(p.deposited.toString()),
    shieldPaid: BigInt(p.shieldPaid.toString()),
    status: enumVariant<ClaimParticipant['status']>(p.status),
    finalized: p.finalized,
    claimed: p.claimed,
  };
}

const BLOCK_REASON: Record<ClaimBlock, string> = {
  not_settled: 'Payouts open once the challenge settles (after the dispute window).',
  not_finalized: 'Your result is being finalized. This takes a few minutes.',
  already_paid: 'Already paid to your wallet.',
  nothing_owed: 'You missed a day, so your stake went to the players who kept their streak.',
};

function outcomeLabel(c: ClaimChallenge, p: ClaimParticipant): string {
  if (c.state === 'cancelled') return 'Cancelled';
  if (c.state === 'open') return 'Results pending';
  if (c.fullRefund) return p.status === 'failed' ? 'Missed a day · everyone refunded' : 'Everyone refunded';
  return { survived: 'Kept the streak', voided: "Couldn't be verified", failed: 'Missed a day', active: 'Results pending' }[p.status];
}

const view = (lines: ReturnType<typeof payoutBreakdown>['lines']): ClaimLineView[] =>
  lines.map((l) => ({ label: l.label, amount: l.amount.toString(), negative: l.negative, note: l.note }));

/** Everything the user is owed or was paid; `onlyChallenge` narrows it to one challenge (its page). */
export async function loadClaimCenter(profileId: string, onlyChallenge?: string): Promise<ClaimCenter> {
  const admin = createSupabaseAdminClient();
  const connection = serverConnection();
  const program = createProgram(connection);

  const memberQuery = admin.from('memberships').select('wallet_address, participant_address, payout, challenges!inner(onchain_address, title, token)').eq('profile_id', profileId);
  const sponsorQuery = admin.from('sponsorships').select('sponsor_wallet, receipt_address, challenges!inner(onchain_address, title, token)').eq('sponsor_id', profileId);
  const [{ data: members }, { data: sponsorships }, { data: wallets }, { data: receipts }] = await Promise.all([
    onlyChallenge ? memberQuery.eq('challenges.onchain_address', onlyChallenge) : memberQuery,
    onlyChallenge ? sponsorQuery.eq('challenges.onchain_address', onlyChallenge) : sponsorQuery,
    onlyChallenge ? Promise.resolve({ data: [] as { address: string }[] }) : admin.from('wallets').select('address').eq('profile_id', profileId).not('verified_at', 'is', null),
    admin.from('receipts').select('kind, tx_signature, wallet, challenges!inner(onchain_address)').eq('profile_id', profileId).in('kind', ['reward', 'refund', 'sponsor_refund']),
  ]);
  type Joined = { onchain_address: string; title: string; token: 'sol' | 'usdc' };
  const one = (j: unknown) => (Array.isArray(j) ? j[0] : j) as Joined;
  const txOf = (challenge: string, wallet: string, sponsor: boolean) =>
    (receipts ?? []).find((r) => one(r.challenges).onchain_address === challenge && r.wallet === wallet && (r.kind === 'sponsor_refund') === sponsor)?.tx_signature as string | undefined;

  const playerRows = (members ?? []).filter((m) => one(m.challenges).onchain_address);
  // Sponsor rows: one per challenge and wallet (several sponsorships share one on-chain receipt).
  const sponsorKeys = new Map<string, { wallet: string; ch: Joined }>();
  for (const s of sponsorships ?? []) sponsorKeys.set(`${one(s.challenges).onchain_address}:${s.sponsor_wallet}`, { wallet: s.sponsor_wallet as string, ch: one(s.challenges) });

  const challengeKeys = [...new Set([...playerRows.map((m) => one(m.challenges).onchain_address), ...[...sponsorKeys.values()].map((s) => s.ch.onchain_address)])];
  if (!challengeKeys.length && !(wallets ?? []).length) return { rows: [], wrapped: [] };
  const challengeAccounts = await program.account.challenge.fetchMultiple(challengeKeys.map((a) => new PublicKey(a)));
  const accountOf = new Map(challengeKeys.map((a, i) => [a, challengeAccounts[i] ?? null]));
  const participantKeys = playerRows.map((m) => new PublicKey((m.participant_address as string | null) ?? participantPda(new PublicKey(one(m.challenges).onchain_address), new PublicKey(m.wallet_address as string)).toBase58()));
  const participants = await program.account.participant.fetchMultiple(participantKeys);
  const sponsorList = [...sponsorKeys.values()];
  const receiptsOnChain = await program.account.sponsorReceipt.fetchMultiple(sponsorList.map((s) => sponsorReceiptPda(new PublicKey(s.ch.onchain_address), new PublicKey(s.wallet))));

  const rows: ClaimRow[] = [];
  playerRows.forEach((m, i) => {
    const ch = one(m.challenges);
    const account = accountOf.get(ch.onchain_address);
    const p = participants[i];
    if (!account || !p) return;
    const c = claimChallenge(account);
    const part = claimParticipant(p);
    const block = claimBlock(c, part);
    const owed = claimable(c, part);
    const paid = part.claimed ? (m.payout != null ? BigInt(String(m.payout).split('.')[0]!) : null) : null;
    const breakdown = payoutBreakdown(c, part, paid);
    rows.push({
      role: 'player',
      challenge: ch.onchain_address,
      title: ch.title,
      token: ch.token,
      outcome: outcomeLabel(c, part),
      state: part.claimed ? 'paid' : block ?? 'claimable',
      reason: part.claimed ? null : block ? BLOCK_REASON[block] : null,
      amount: (part.claimed ? breakdown.total : owed?.amount ?? 0n).toString(),
      lines: view(breakdown.lines),
      paidTx: txOf(ch.onchain_address, m.wallet_address as string, false) ?? null,
      settlesAt: c.state === 'open' ? disputeEndTs(challengeTimes(account)) : null,
    });
  });
  sponsorList.forEach((s, i) => {
    const account = accountOf.get(s.ch.onchain_address);
    const r = receiptsOnChain[i];
    if (!account || !r) return;
    const c = claimChallenge(account);
    const refunds = c.state === 'cancelled' || (c.state === 'settled' && c.fullRefund);
    const amount = BigInt(r.amount.toString());
    rows.push({
      role: 'sponsor',
      challenge: s.ch.onchain_address,
      title: s.ch.title,
      token: s.ch.token,
      outcome: c.state === 'open' ? 'Running' : refunds ? 'Sponsorship refunded' : 'Sponsorship paid to survivors',
      state: r.refunded ? 'paid' : refunds ? 'claimable' : c.state === 'open' ? 'not_settled' : 'nothing_owed',
      reason: r.refunded
        ? null
        : refunds
          ? null
          : c.state === 'open'
            ? 'Sponsorships are refunded only if the challenge is cancelled or nobody keeps their streak.'
            : 'Your sponsorship rewarded the players who kept their streak. Thank you!',
      amount: (refunds || r.refunded ? amount : 0n).toString(),
      lines: [{ label: 'Your sponsorship', amount: amount.toString(), negative: !refunds && !r.refunded, note: refunds || r.refunded ? 'returned to you' : undefined }],
      paidTx: txOf(s.ch.onchain_address, s.wallet, true) ?? null,
      settlesAt: c.state === 'open' ? disputeEndTs(challengeTimes(account)) : null,
    });
  });

  // Wrapped SOL waiting in the user's own wSOL accounts (SOL payouts arrive wrapped).
  const wrapped: WrappedSolView[] = [];
  for (const w of wallets ?? []) {
    const account = associatedTokenAddress(new PublicKey(w.address as string), WSOL_MINT_KEY);
    const balance = await connection.getTokenAccountBalance(account).catch(() => null);
    if (balance && BigInt(balance.value.amount) > 0n) wrapped.push({ wallet: w.address as string, account: account.toBase58(), amount: balance.value.amount });
  }
  return { rows, wrapped };
}

// ---------------------------------------------------------------- claim now (server-sent)

/** One fixed request key per player/sponsor and challenge: the lock against two claims racing. */
function claimKey(role: ClaimRole, account: string): string {
  const h = createHash('sha256').update(`claim:${role}:${account}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** The owner's token account for the mint, created first if missing (rent paid by the relayer). */
async function ensureTokenAccount(connection: Connection, owner: PublicKey, mint: PublicKey, tokenProgram: PublicKey): Promise<PublicKey> {
  const account = associatedTokenAddress(owner, mint, tokenProgram);
  if (await connection.getAccountInfo(account)) return account;
  const relayer = relayerKeypair();
  const ix = new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgram, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // CreateIdempotent
  });
  const sig = await connection.sendTransaction(new Transaction().add(ix), [relayer]);
  await connection.confirmTransaction(sig, 'confirmed');
  return account;
}

const refuse = (error: string, code: string, title: string) => ({ ok: false as const, error, code, title });

/**
 * Sends the claim for the signed-in user's own payout in `challengeAddress`. Refuses (with the
 * reason) before settlement, when nothing is owed, and when it was already paid (then mirrors it).
 */
export async function claimNow(input: { profileId: string; challengeAddress: string; role: ClaimRole }): Promise<RelayResult<{ signature: string; amount: string } | { alreadyPaid: true }>> {
  const admin = createSupabaseAdminClient();
  const connection = serverConnection();
  const program = createProgram(connection);
  const relayer = relayerKeypair();
  const challengeKey = new PublicKey(input.challengeAddress);

  const { data: ch } = await admin.from('challenges').select('id').eq('onchain_address', input.challengeAddress).maybeSingle();
  if (!ch) return refuse('This challenge is not in CodeStreak.', 'claim.unknown', 'Not found');

  // Whose payout: only the signed-in user's own membership or sponsorship.
  let owner: PublicKey;
  if (input.role === 'player') {
    const { data: m } = await admin.from('memberships').select('wallet_address').eq('challenge_id', ch.id).eq('profile_id', input.profileId).maybeSingle();
    if (!m) return refuse("You didn't play in this challenge.", 'claim.not_member', 'Nothing to claim');
    owner = new PublicKey(m.wallet_address as string);
  } else {
    const { data: s } = await admin.from('sponsorships').select('sponsor_wallet').eq('challenge_id', ch.id).eq('sponsor_id', input.profileId).limit(1).maybeSingle();
    if (!s) return refuse("You didn't sponsor this challenge.", 'claim.not_sponsor', 'Nothing to claim');
    owner = new PublicKey(s.sponsor_wallet as string);
  }

  const account = await program.account.challenge.fetchNullable(challengeKey);
  if (!account) return refuse('The challenge account is not on devnet.', 'claim.unknown', 'Not found');
  const c = claimChallenge(account);
  const times = challengeTimes(account);
  const target = input.role === 'player' ? participantPda(challengeKey, owner) : sponsorReceiptPda(challengeKey, owner);

  // Decide from the chain, right now.
  let kind: 'claim_reward' | 'claim_refund' | 'claim_sponsor_refund';
  let amount: bigint;
  if (input.role === 'player') {
    const p = await program.account.participant.fetchNullable(target);
    if (!p) return refuse('No stake from your wallet in this challenge.', 'claim.not_member', 'Nothing to claim');
    const part = claimParticipant(p);
    const block = claimBlock(c, part);
    if (block === 'already_paid') {
      await mirrorPaid(ch.id as string, owner.toBase58(), 'player', null, c, part);
      return { ok: true, alreadyPaid: true };
    }
    if (block === 'not_settled') {
      const phase = challengePhase(times, Math.floor(Date.now() / 1000));
      const when = new Date(disputeEndTs(times) * 1000).toUTCString();
      return refuse(
        phase === 'awaitingSettlement' ? 'The challenge is being settled. Payouts open in a few minutes.' : `Payouts open after the dispute window ends (${when}).`,
        'claim.not_settled',
        'Not settled yet',
      );
    }
    if (block) return refuse(BLOCK_REASON[block], `claim.${block}`, block === 'nothing_owed' ? 'Nothing to claim' : 'Not yet');
    const owed = claimable(c, part)!;
    kind = owed.kind === 'reward' ? 'claim_reward' : 'claim_refund';
    amount = owed.amount;
  } else {
    const r = await program.account.sponsorReceipt.fetchNullable(target);
    if (!r) return refuse('No sponsorship from your wallet in this challenge.', 'claim.not_sponsor', 'Nothing to claim');
    if (r.refunded) return { ok: true, alreadyPaid: true };
    if (!(c.state === 'cancelled' || (c.state === 'settled' && c.fullRefund))) {
      return refuse(
        c.state === 'open' ? 'Sponsorships are refunded only if the challenge is cancelled or nobody keeps their streak.' : 'Your sponsorship went to the players who kept their streak.',
        c.state === 'open' ? 'claim.not_settled' : 'claim.nothing_owed',
        'Nothing to claim',
      );
    }
    kind = 'claim_sponsor_refund';
    amount = BigInt(r.amount.toString());
  }

  // The lock: one claim request per player/sponsor and challenge.
  const key = claimKey(input.role, target.toBase58());
  const { data: prior } = await admin.from('relayer_requests').select('id, status, signature, updated_at').eq('profile_id', input.profileId).eq('idempotency_key', key).maybeSingle();
  if (prior?.status === 'confirmed') return { ok: true, signature: prior.signature as string, amount: amount.toString() };
  if (prior?.status === 'submitting' && Date.now() - Date.parse(prior.updated_at as string) < STALE_CLAIM_MS) {
    return refuse('Your claim is already on its way. Refresh in a minute.', 'claim.in_progress', 'Already claiming');
  }
  if (!prior) {
    const limit = rateLimitDecision(await relayerUsage(input.profileId));
    if (!limit.ok) return refuse(limit.message, 'relayer.rate_limited', 'Slow down');
  }
  if ((await connection.getBalance(relayer.publicKey)) < MIN_RELAYER_LAMPORTS) {
    return refuse('Claims are paused (the relayer is low on devnet SOL). Your payout is safe; it is also sent automatically.', 'relayer.low_funds', 'Paused');
  }

  const destination = await ensureTokenAccount(connection, owner, account.mint, account.tokenProgram);
  const accounts =
    kind === 'claim_sponsor_refund'
      ? { challenge: challengeKey, receipt: target, mint: account.mint, destination, vault: account.vault, tokenProgram: account.tokenProgram }
      : { challenge: challengeKey, participant: target, mint: account.mint, destination, vault: account.vault, tokenProgram: account.tokenProgram };
  const method = kind === 'claim_reward' ? program.methods.claimReward() : kind === 'claim_refund' ? program.methods.claimRefund() : program.methods.claimSponsorRefund();
  const ix = await method.accountsPartial(accounts as never).instruction();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: relayer.publicKey, blockhash, lastValidBlockHeight }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 120_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
    ix,
  );
  const policy = checkRelayedTransaction(tx, { relayer: relayer.publicKey, user: owner, allowed: [kind] });
  if (!policy.ok) return refuse(`Refused: ${policy.errors.join('; ')}`, 'relayer.policy', 'Refused by the relayer');
  tx.sign(relayer);
  const raw = tx.serialize();
  const row = {
    kind: 'claim' as const,
    challenge_address: input.challengeAddress,
    wallet: owner.toBase58(),
    message_hash: createHash('sha256').update(tx.serializeMessage()).digest('hex'),
    prepared_tx: raw.toString('base64'),
    last_valid_block_height: lastValidBlockHeight,
    status: 'submitting' as const,
    error: null,
    updated_at: new Date().toISOString(),
  };
  // Take the lock (insert, or re-take a failed/stale one); losing the race means another claim runs.
  const locked = prior
    ? await admin.from('relayer_requests').update(row).eq('id', prior.id).eq('status', prior.status).eq('updated_at', prior.updated_at).select('id')
    : await admin.from('relayer_requests').insert({ ...row, profile_id: input.profileId, idempotency_key: key }).select('id');
  if (locked.error || !locked.data?.length) return refuse('Your claim is already on its way. Refresh in a minute.', 'claim.in_progress', 'Already claiming');
  const id = locked.data[0]!.id as string;

  const sim = await connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), { sigVerify: false });
  if (sim.value.err) {
    await admin.from('relayer_requests').update({ status: 'failed', error: JSON.stringify(sim.value.err).slice(0, 500) }).eq('id', id);
    // The worker may have paid it a moment ago: report that instead of an error.
    if (await alreadyClaimed(program, input.role, target)) return { ok: true, alreadyPaid: true };
    return refuse('The claim was refused by the program. Refresh: your payout may have just been sent automatically.', 'claim.simulation', 'Could not claim');
  }
  let signature: string;
  try {
    signature = await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 3 });
    const confirmation = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    if (confirmation.value.err) throw new Error(JSON.stringify(confirmation.value.err));
  } catch (e) {
    await admin.from('relayer_requests').update({ status: 'failed', error: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).eq('id', id);
    if (await alreadyClaimed(program, input.role, target)) return { ok: true, alreadyPaid: true };
    return refuse('Solana devnet did not confirm the claim. Try again in a minute.', 'claim.unconfirmed', 'Not confirmed');
  }
  await admin.from('relayer_requests').update({ status: 'confirmed', signature, error: null }).eq('id', id);
  await admin.rpc('record_payout', {
    p_challenge: ch.id,
    p_wallet: owner.toBase58(),
    p_kind: kind === 'claim_reward' ? 'reward' : kind === 'claim_refund' ? 'refund' : 'sponsor_refund',
    p_amount: amount.toString(),
    p_tx: signature,
  });
  await admin.from('audit_log').insert({
    actor_kind: 'relayer',
    actor_id: input.profileId,
    action: 'relayer.claim',
    entity_type: 'challenge',
    entity_id: input.challengeAddress,
    details: { signature, wallet: owner.toBase58(), kind, amount: amount.toString() },
  });
  return { ok: true, signature, amount: amount.toString() };
}

async function alreadyClaimed(program: ReturnType<typeof createProgram>, role: ClaimRole, target: PublicKey): Promise<boolean> {
  if (role === 'player') return Boolean((await program.account.participant.fetchNullable(target))?.claimed);
  return Boolean((await program.account.sponsorReceipt.fetchNullable(target))?.refunded);
}

/** Paid on-chain but not shown as paid in the app (e.g. paid while this server was down): mirror it. */
async function mirrorPaid(challengeId: string, wallet: string, role: ClaimRole, tx: string | null, c: ClaimChallenge, p: ClaimParticipant) {
  if (role !== 'player') return;
  const owed = claimable(c, { ...p, claimed: false });
  if (!owed) return;
  await createSupabaseAdminClient().rpc('record_payout', { p_challenge: challengeId, p_wallet: wallet, p_kind: owed.kind, p_amount: owed.amount.toString(), p_tx: tx });
}

// ---------------------------------------------------------------- unwrap (you sign, relayer pays the fee)

export async function prepareUnwrap(input: { profileId: string; wallet: string; idempotencyKey: string }): Promise<RelayResult<{ transaction: string } | { signature: string }>> {
  const admin = createSupabaseAdminClient();
  const connection = serverConnection();
  const relayer = relayerKeypair();
  const user = new PublicKey(input.wallet);
  const account = associatedTokenAddress(user, WSOL_MINT_KEY);

  const { data: existing } = await admin.from('relayer_requests').select('status, signature, prepared_tx, last_valid_block_height').eq('profile_id', input.profileId).eq('idempotency_key', input.idempotencyKey).maybeSingle();
  if (existing?.status === 'confirmed') return { ok: true, signature: existing.signature as string };
  if (existing?.status === 'prepared' && (await connection.getBlockHeight('confirmed')) < Number(existing.last_valid_block_height)) {
    return { ok: true, transaction: existing.prepared_tx as string };
  }
  if (existing) return refuse('This unwrap request was already used. Refresh and try again.', 'relayer.reused', 'Try again');

  if (!(await connection.getAccountInfo(account))) return refuse('This wallet has no wrapped SOL.', 'unwrap.nothing', 'Nothing to unwrap');
  const limit = rateLimitDecision(await relayerUsage(input.profileId));
  if (!limit.ok) return refuse(limit.message, 'relayer.rate_limited', 'Slow down');
  if ((await connection.getBalance(relayer.publicKey)) < MIN_RELAYER_LAMPORTS) {
    return refuse('Unwrapping is paused (the relayer is low on devnet SOL). Your wrapped SOL is safe.', 'relayer.low_funds', 'Paused');
  }

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: relayer.publicKey, blockhash, lastValidBlockHeight }).add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
    closeWrappedSolAccountInstruction(user, account),
  );
  const policy = checkUnwrapTransaction(tx, { relayer: relayer.publicKey, user, account });
  if (!policy.ok) return refuse(`Refused: ${policy.errors.join('; ')}`, 'relayer.policy', 'Refused by the relayer');
  const sim = await connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), { sigVerify: false });
  if (sim.value.err) return refuse('Solana refused to close the wrapped SOL account.', 'unwrap.simulation', 'Could not unwrap');

  tx.partialSign(relayer);
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  const { error } = await admin.from('relayer_requests').insert({
    profile_id: input.profileId,
    idempotency_key: input.idempotencyKey,
    kind: 'unwrap',
    challenge_address: null,
    wallet: input.wallet,
    message_hash: createHash('sha256').update(tx.serializeMessage()).digest('hex'),
    prepared_tx: serialized,
    last_valid_block_height: lastValidBlockHeight,
    status: 'prepared',
    payload: { account: account.toBase58() },
  });
  if (error) return refuse('Could not save the request. Try again.', 'relayer.save', 'Try again');
  return { ok: true, transaction: serialized };
}
