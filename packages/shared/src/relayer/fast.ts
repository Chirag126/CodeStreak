// Phase 42 - transactions that land faster and cost as little as possible.
//
// 1. Compute budget from a simulation: run the transaction once with a generous limit, read the
//    compute it actually used, and request that plus a safety margin (a tight limit makes the
//    priority fee, which is price × requested units, as small as it can be).
// 2. Priority fee from the network: a percentile of recent prioritization fees paid on the accounts
//    this transaction writes, clamped to a floor (always a little priority) and a cap (never
//    overpay). Falls back to the floor when the RPC can't answer.
// 3. Send with resend: send, then keep re-sending the same signed bytes and polling its status
//    until it is confirmed, it fails, or its blockhash expires. An expired transaction can never
//    land later, so "expired" is a definite answer and nothing was charged.
//
// Pure helpers are unit-tested; the RPC helpers take a Connection-like object so they can be too.

import { ComputeBudgetProgram, PublicKey, Transaction, VersionedTransaction, type Connection, type TransactionError, type TransactionInstruction } from '@solana/web3.js';

export const FEE_POLICY = {
  /** Always pay at least this (micro-lamports per compute unit): cheap, but ahead of zero-priority traffic. */
  floorMicroLamports: 1_000,
  /** Never pay more than this per compute unit (the relayer policy allows up to 100,000). */
  capMicroLamports: 50_000,
  /** Which recent fee to match: the 75th percentile lands quickly without paying the top. */
  percentile: 75,
  /** Fewer non-zero samples than this means the network is quiet: use the floor. */
  minSamples: 3,
} as const;

export const COMPUTE_POLICY = {
  /** Requested = used × margin + headroom (state can differ slightly between simulation and execution). */
  margin: 1.15,
  headroom: 5_000,
  /** Never request less than this. */
  min: 10_000,
} as const;

/** Micro-lamports per compute unit from recent prioritization-fee samples (zeros = slots with no priority). */
export function priorityFeeFromSamples(samples: readonly number[], policy: { floorMicroLamports: number; capMicroLamports: number; percentile: number; minSamples: number } = FEE_POLICY): number {
  const paid = samples.filter((s) => Number.isFinite(s) && s > 0).sort((a, b) => a - b);
  if (paid.length < policy.minSamples) return policy.floorMicroLamports;
  const idx = Math.min(paid.length - 1, Math.max(0, Math.ceil((policy.percentile / 100) * paid.length) - 1));
  return Math.min(policy.capMicroLamports, Math.max(policy.floorMicroLamports, Math.round(paid[idx]!)));
}

/** The compute-unit limit to request, given what the simulation used (null = unknown: use the cap). */
export function tightComputeUnits(consumed: number | null | undefined, cap: number, policy: { margin: number; headroom: number; min: number } = COMPUTE_POLICY): number {
  if (!consumed || !Number.isFinite(consumed) || consumed <= 0) return cap;
  return Math.min(cap, Math.max(policy.min, Math.ceil(consumed * policy.margin) + policy.headroom));
}

/** Lamports a priority fee adds: price (micro-lamports per CU) × requested units, rounded up. */
export function priorityFeeLamports(microLamports: number, units: number): number {
  return Math.ceil((microLamports * units) / 1_000_000);
}

/** The two compute-budget instructions, limit first (the shape the relayer policy accepts). */
export function computeBudgetInstructions(units: number, microLamports: number): TransactionInstruction[] {
  return [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports })];
}

type FeeRpc = Pick<Connection, 'getRecentPrioritizationFees'>;

/** Recent priority fee for these writable accounts, from the RPC. Never throws (floor on failure). */
export async function recentPriorityFee(connection: FeeRpc, writable: readonly PublicKey[]): Promise<number> {
  try {
    const unique = [...new Map(writable.map((k) => [k.toBase58(), k])).values()].slice(0, 128);
    const fees = await connection.getRecentPrioritizationFees(unique.length ? { lockedWritableAccounts: unique } : undefined);
    return priorityFeeFromSamples(fees.map((f) => f.prioritizationFee));
  } catch {
    return FEE_POLICY.floorMicroLamports;
  }
}

export interface ComputePlan {
  units: number;
  microLamports: number;
  /** What the simulation used (null if it failed before reporting it). */
  unitsConsumed: number | null;
  /** The simulation's error and logs, if it failed (the transaction would fail the same way). */
  err: TransactionError | string | null;
  logs: string[] | null;
}

type PlanRpc = FeeRpc & Pick<Connection, 'simulateTransaction'>;

// Simulation replaces the blockhash, so any well-formed one will do (saves an RPC round trip).
const PLACEHOLDER_BLOCKHASH = new PublicKey(0).toBase58();

/**
 * Simulates `instructions` (paid by `payer`) with `cap` units and the current priority fee, then
 * returns a tight limit and the fee to use. Doesn't sign or send anything.
 */
export async function planComputeBudget(connection: PlanRpc, input: { payer: PublicKey; instructions: TransactionInstruction[]; cap: number }): Promise<ComputePlan> {
  const writable = input.instructions.flatMap((ix) => ix.keys.filter((k) => k.isWritable).map((k) => k.pubkey));
  const microLamports = await recentPriorityFee(connection, [input.payer, ...writable]);
  const tx = new Transaction({ feePayer: input.payer, recentBlockhash: PLACEHOLDER_BLOCKHASH }).add(...computeBudgetInstructions(input.cap, microLamports), ...input.instructions);
  try {
    const sim = await connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
    const used = sim.value.unitsConsumed ?? null;
    return { units: tightComputeUnits(used, input.cap), microLamports, unitsConsumed: used, err: sim.value.err ?? null, logs: sim.value.logs ?? null };
  } catch {
    // The RPC couldn't simulate: send with the cap (always enough) rather than fail the action.
    return { units: input.cap, microLamports, unitsConsumed: null, err: null, logs: null };
  }
}

// ---------------------------------------------------------------- send until it lands or expires

/** The network did not include the transaction before its blockhash expired. It can never land now. */
export class TransactionExpiredError extends Error {
  constructor(readonly signature: string) {
    super('Transaction expired: the network did not include it before its blockhash expired, so nothing was charged.');
    this.name = 'TransactionExpiredError';
  }
}

/** The transaction landed and failed on-chain (fee paid, nothing else changed). */
export class TransactionFailedError extends Error {
  constructor(
    readonly signature: string,
    readonly err: TransactionError,
  ) {
    super(`Transaction failed: ${JSON.stringify(err)}`);
    this.name = 'TransactionFailedError';
  }
}

/** Still not confirmed after the wait (rare: the RPC is not answering). The outcome is unknown. */
export class TransactionUnconfirmedError extends Error {
  constructor(readonly signature: string) {
    super('Transaction not confirmed yet: the network is slow to answer. It may still land; check again in a minute.');
    this.name = 'TransactionUnconfirmedError';
  }
}

type SendRpc = Pick<Connection, 'sendRawTransaction' | 'getSignatureStatuses' | 'getBlockHeight'>;

export interface SendOptions {
  lastValidBlockHeight: number;
  commitment?: 'confirmed' | 'finalized';
  /** Re-send the same bytes this often while the network hasn't seen it. */
  resendMs?: number;
  /** Check its status this often. */
  pollMs?: number;
  /** Give up waiting after this long (the outcome is then unknown, never "failed"). */
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Sends a fully signed transaction and waits until it is confirmed. Re-sends the same bytes (same
 * signature, so it can't be paid twice) while the network hasn't seen it, and stops with
 * TransactionExpiredError once the blockhash is past `lastValidBlockHeight` and it never landed.
 */
export async function sendWithResend(connection: SendRpc, raw: Uint8Array, opts: SendOptions): Promise<string> {
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const resendMs = opts.resendMs ?? 2_000;
  const pollMs = opts.pollMs ?? 800;
  const maxWaitMs = opts.maxWaitMs ?? 120_000;
  const wanted = opts.commitment ?? 'confirmed';
  const done = (s: string | null | undefined) => s === 'finalized' || (wanted === 'confirmed' && s === 'confirmed');

  const bytes = Buffer.from(raw);
  const signature = await connection.sendRawTransaction(bytes, { skipPreflight: true, maxRetries: 0 });
  const started = now();
  let lastSend = started;
  let seen = false;

  for (;;) {
    await sleep(pollMs);
    const { value } = await connection.getSignatureStatuses([signature], { searchTransactionHistory: false }).catch(() => ({ value: [null] }));
    const status = value[0];
    if (status) {
      seen = true;
      if (status.err) throw new TransactionFailedError(signature, status.err);
      if (done(status.confirmationStatus)) return signature;
    }
    // Not seen yet: has the blockhash expired? (Seen = it will be confirmed or fail; keep waiting.)
    if (!seen) {
      const height = await connection.getBlockHeight('confirmed').catch(() => null);
      if (height !== null && height > opts.lastValidBlockHeight) {
        // One last look, including history, in case it landed right at the end.
        const last = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true }).catch(() => ({ value: [null] }))).value[0];
        if (last?.err) throw new TransactionFailedError(signature, last.err);
        if (last && done(last.confirmationStatus)) return signature;
        if (!last) throw new TransactionExpiredError(signature);
        seen = true;
      }
    }
    if (now() - started > maxWaitMs) throw new TransactionUnconfirmedError(signature);
    if (!seen && now() - lastSend >= resendMs) {
      lastSend = now();
      await connection.sendRawTransaction(bytes, { skipPreflight: true, maxRetries: 0 }).catch(() => undefined);
    }
  }
}
