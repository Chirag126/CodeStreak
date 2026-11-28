// Relayer rules (pure): what the CodeStreak relayer will pay fees for and co-sign. Used by the web
// server before it pre-signs and again before it submits. Import from "@codestreak/shared/relayer".
import { PublicKey, SystemProgram, TransactionInstruction, type Transaction } from '@solana/web3.js';

import { CODESTREAK_IDL_JSON } from '../program/idl/codestreak.idl.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, entryGatePda, PROGRAM_ID, TOKEN_PROGRAM_ID } from '../program/pdas.js';

export * from './fast.js';

export const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey('ComputeBudget111111111111111111111111111111');

/** Program instructions the relayer sponsors (user actions only; never admin, verifier or settlement). */
export const RELAYED_INSTRUCTIONS = ['initialize_pool', 'join_pool', 'sponsor_pool', 'activate_shield', 'claim_reward', 'claim_refund', 'claim_sponsor_refund'] as const;
export type RelayedInstruction = (typeof RELAYED_INSTRUCTIONS)[number];

/** Accounts the relayer itself may fill: rent payer and private-group co-signer. */
const RELAYER_ROLES = new Set(['payer', 'join_authority']);

export const COMPUTE_LIMITS = { maxUnits: 200_000, maxMicroLamports: 100_000 } as const;

type IdlInstruction = (typeof CODESTREAK_IDL_JSON.instructions)[number];
type IdlAccount = { name: string; writable?: boolean; signer?: boolean; optional?: boolean; address?: string };

const byName = new Map<string, IdlInstruction>(CODESTREAK_IDL_JSON.instructions.map((i) => [i.name, i]));
const byDiscriminator = new Map<string, IdlInstruction>(CODESTREAK_IDL_JSON.instructions.map((i) => [i.discriminator.join(','), i]));

function accountsOf(ix: IdlInstruction): IdlAccount[] {
  return ix.accounts as unknown as IdlAccount[];
}

/** Which program instruction this is, from its 8-byte discriminator. */
export function decodeInstructionName(data: Uint8Array): string | null {
  if (data.length < 8) return null;
  return byDiscriminator.get(Array.from(data.subarray(0, 8)).join(','))?.name ?? null;
}

/**
 * Builds a CodeStreak instruction straight from the IDL (account order, signer/writable flags, the
 * program-ID placeholder for an absent optional account). Args: u64 `amount`, u16 `day` (Shields).
 */
export function buildCodestreakInstruction(
  name: RelayedInstruction,
  accounts: Record<string, PublicKey | null | undefined>,
  args: { amount?: bigint; day?: number } = {},
  programId: PublicKey = PROGRAM_ID,
): TransactionInstruction {
  const idl = byName.get(name);
  if (!idl) throw new Error(`unknown instruction ${name}`);
  const keys = accountsOf(idl).map((a) => {
    // The entry gate has one fixed address (a PDA of constant seeds), so it is filled in here.
    const value = accounts[a.name] ?? (a.name === 'entry_gate' ? entryGatePda(programId) : a.address ? new PublicKey(a.address) : null);
    if (!value) {
      if (a.optional) return { pubkey: programId, isSigner: false, isWritable: false };
      throw new Error(`${name}: missing account ${a.name}`);
    }
    return { pubkey: value, isSigner: Boolean(a.signer), isWritable: Boolean(a.writable) };
  });
  const parts: Uint8Array[] = [Uint8Array.from(idl.discriminator)];
  for (const arg of idl.args as unknown as { name: string; type: string }[]) {
    if (arg.type === 'u64' && arg.name === 'amount' && args.amount !== undefined) {
      const buf = new Uint8Array(8);
      new DataView(buf.buffer).setBigUint64(0, args.amount, true);
      parts.push(buf);
    } else if (arg.type === 'u16' && arg.name === 'day' && args.day !== undefined && Number.isInteger(args.day) && args.day >= 0 && args.day <= 0xffff) {
      const buf = new Uint8Array(2);
      new DataView(buf.buffer).setUint16(0, args.day, true);
      parts.push(buf);
    } else {
      throw new Error(`${name}: unsupported argument ${arg.name}`);
    }
  }
  const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    data.set(p, offset);
    offset += p.length;
  }
  return new TransactionInstruction({ programId, keys, data: Buffer.from(data) });
}

function checkComputeBudget(data: Uint8Array, seen: Set<number>, errors: string[]): void {
  const kind = data[0];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (kind === undefined || seen.has(kind)) {
    errors.push('duplicate or empty compute-budget instruction');
    return;
  }
  seen.add(kind);
  if (kind === 2 && data.length === 5) {
    if (view.getUint32(1, true) > COMPUTE_LIMITS.maxUnits) errors.push('compute unit limit above the relayer cap');
  } else if (kind === 3 && data.length === 9) {
    if (view.getBigUint64(1, true) > BigInt(COMPUTE_LIMITS.maxMicroLamports)) errors.push('priority fee above the relayer cap');
  } else {
    errors.push('compute-budget instruction not allowed');
  }
}

export const WSOL_MINT_KEY = new PublicKey('So11111111111111111111111111111111111111112');

// ---------------------------------------------------------------- SOL staking: wrap around the join
// The program takes token accounts only, so a SOL stake is wrapped in the same transaction:
//   [create user's wSOL account] → transfer SOL into it → sync_native → join → [close it]
// These four shapes are the only extra instructions the relayer ever accepts, and only for the
// user's own wSOL account, with the user (never the relayer) paying and signing.

/** Create the user's wSOL associated token account if it doesn't exist (paid by the user). */
export function createWrappedSolAccountInstruction(user: PublicKey, account: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: false, isWritable: false },
      { pubkey: WSOL_MINT_KEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // CreateIdempotent
  });
}

/** SOL → wSOL: move lamports into the wSOL account, then let the token program count them. */
export function wrapSolInstructions(user: PublicKey, account: PublicKey, lamports: bigint): TransactionInstruction[] {
  return [
    SystemProgram.transfer({ fromPubkey: user, toPubkey: account, lamports }),
    new TransactionInstruction({ programId: TOKEN_PROGRAM_ID, keys: [{ pubkey: account, isSigner: false, isWritable: true }], data: Buffer.from([17]) }), // SyncNative
  ];
}

/** Close the (now empty) wSOL account, returning its rent to the user. */
export function closeWrappedSolAccountInstruction(user: PublicKey, account: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([9]), // CloseAccount
  });
}

export interface WrapContext {
  /** The user's wSOL associated token account. */
  account: PublicKey;
  /** At most this many lamports may be wrapped (the buy-in). */
  maxLamports: bigint;
}

/** Checks one wrap-related instruction; `afterJoin` says whether the CodeStreak instruction came already. */
function checkWrapInstruction(ix: TransactionInstruction, ctx: PolicyContext & { wrap: WrapContext }, afterJoin: boolean, errors: string[]): void {
  const { wrap, user, relayer } = ctx;
  const keys = ix.keys.map((k) => k.pubkey);
  if (keys.some((k) => k.equals(relayer))) {
    errors.push('the relayer cannot take part in wrapping SOL');
    return;
  }
  const kind = ix.data[0];
  if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
    const ok = !afterJoin && kind === 1 && ix.data.length === 1 && keys.length === 6 && keys[0]!.equals(user) && keys[1]!.equals(wrap.account) && keys[2]!.equals(user) && keys[3]!.equals(WSOL_MINT_KEY);
    if (!ok) errors.push('only creating your own wSOL account, before joining, is allowed');
  } else if (ix.programId.equals(SystemProgram.programId)) {
    const view = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength);
    const isTransfer = ix.data.length === 12 && view.getUint32(0, true) === 2;
    const lamports = isTransfer ? view.getBigUint64(4, true) : -1n;
    const ok = !afterJoin && isTransfer && keys.length === 2 && keys[0]!.equals(user) && keys[1]!.equals(wrap.account) && lamports > 0n && lamports <= wrap.maxLamports;
    if (!ok) errors.push('SOL may only move from your wallet into your wSOL account, up to the buy-in, before joining');
  } else if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
    const sync = !afterJoin && kind === 17 && ix.data.length === 1 && keys.length === 1 && keys[0]!.equals(wrap.account);
    const close = afterJoin && kind === 9 && ix.data.length === 1 && keys.length === 3 && keys[0]!.equals(wrap.account) && keys[1]!.equals(user) && keys[2]!.equals(user);
    if (!sync && !close) errors.push('token instruction not allowed (only syncing or closing your own wSOL account)');
  } else {
    errors.push(`program ${ix.programId.toBase58()} is not allowed`);
  }
}

export interface PolicyContext {
  relayer: PublicKey;
  /** The user's linked wallet: the only other key allowed to sign. */
  user: PublicKey;
  programId?: PublicKey;
  allowed?: readonly RelayedInstruction[];
  /** SOL stakes only: allow wrapping into (and closing) the user's own wSOL account. */
  wrap?: WrapContext;
}

export type PolicyResult = { ok: true; instruction: RelayedInstruction } | { ok: false; errors: string[] };

/**
 * Everything a relayed transaction must satisfy before the relayer pays for it:
 * - the relayer pays the fee;
 * - only compute-budget (within caps) and exactly one allowlisted CodeStreak instruction;
 *   nothing else (no token or SOL transfers, no other programs);
 * - the relayer appears only as fee payer, rent payer or private-group co-signer;
 * - the only signers are the relayer and the user's linked wallet, which fills the user slot.
 */
export function checkRelayedTransaction(tx: Transaction, ctx: PolicyContext): PolicyResult {
  const programId = ctx.programId ?? PROGRAM_ID;
  const allowed = new Set<string>(ctx.allowed ?? RELAYED_INSTRUCTIONS);
  const errors: string[] = [];
  if (!tx.feePayer?.equals(ctx.relayer)) errors.push('the relayer must be the fee payer');

  const budgetSeen = new Set<number>();
  let found: { name: string; ix: TransactionInstruction } | null = null;
  for (const ix of tx.instructions) {
    if (ix.programId.equals(COMPUTE_BUDGET_PROGRAM_ID)) {
      checkComputeBudget(ix.data, budgetSeen, errors);
    } else if (ix.programId.equals(programId)) {
      const name = decodeInstructionName(ix.data);
      if (found) errors.push('only one CodeStreak instruction per transaction');
      else if (!name || !allowed.has(name)) errors.push(`CodeStreak instruction ${name ?? 'unknown'} is not relayed`);
      else found = { name, ix };
    } else if (ctx.wrap) {
      checkWrapInstruction(ix, { ...ctx, wrap: ctx.wrap }, found !== null, errors);
    } else {
      errors.push(`program ${ix.programId.toBase58()} is not allowed`);
    }
  }
  if (!found && !errors.some((e) => e.startsWith('CodeStreak'))) errors.push('no CodeStreak instruction');

  if (found) {
    const idl = accountsOf(byName.get(found.name)!);
    if (found.ix.keys.length !== idl.length) {
      errors.push('accounts do not match the instruction layout');
    } else {
      idl.forEach((account, i) => {
        const key = found!.ix.keys[i]!.pubkey;
        if (key.equals(ctx.relayer) && !RELAYER_ROLES.has(account.name)) errors.push(`the relayer cannot be ${account.name}`);
        if (account.name === 'join_authority' && !key.equals(programId) && !key.equals(ctx.relayer)) {
          errors.push('join authority must be the relayer');
        }
        if (account.name === 'payer' && !key.equals(ctx.relayer)) errors.push('the relayer must pay the rent');
        if (account.name === 'entry_gate' && !key.equals(entryGatePda(programId))) errors.push('wrong entry gate account');
        if (account.signer && !RELAYER_ROLES.has(account.name) && !key.equals(ctx.user)) {
          errors.push(`${account.name} must be your linked wallet`);
        }
      });
    }
  }

  // Only the relayer and the user may sign (no hidden extra signers).
  const message = tx.compileMessage();
  const signers = message.accountKeys.slice(0, message.header.numRequiredSignatures);
  for (const s of signers) {
    if (!s.equals(ctx.relayer) && !s.equals(ctx.user)) errors.push(`unexpected signer ${s.toBase58()}`);
  }

  return errors.length || !found ? { ok: false, errors: errors.length ? errors : ['invalid transaction'] } : { ok: true, instruction: found.name as RelayedInstruction };
}

// ---------------------------------------------------------------- SOL payouts: unwrap (Phase 30)
// Payouts arrive as wrapped SOL in the owner's wSOL account. Unwrapping closes that account: every
// lamport in it (the payout plus its rent) goes to the owner. The relayer only pays the fee.

/** The only transaction the relayer co-signs for unwrapping: compute budget + CloseAccount(owner's wSOL ATA → owner). */
export function checkUnwrapTransaction(tx: Transaction, ctx: { relayer: PublicKey; user: PublicKey; account: PublicKey }): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!tx.feePayer?.equals(ctx.relayer)) errors.push('the relayer must be the fee payer');
  const budgetSeen = new Set<number>();
  let closes = 0;
  for (const ix of tx.instructions) {
    if (ix.programId.equals(COMPUTE_BUDGET_PROGRAM_ID)) {
      checkComputeBudget(ix.data, budgetSeen, errors);
    } else if (ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data.length === 1 && ix.data[0] === 9) {
      closes++;
      const [account, destination, owner] = ix.keys;
      if (ix.keys.length !== 3 || !account || !destination || !owner) errors.push('close: wrong accounts');
      else {
        if (!account.pubkey.equals(ctx.account)) errors.push('close: only your own wrapped SOL account');
        if (!destination.pubkey.equals(ctx.user)) errors.push('close: the SOL must go to your own wallet');
        if (!owner.pubkey.equals(ctx.user) || !owner.isSigner) errors.push('close: you must sign as the owner');
      }
    } else {
      errors.push(`program ${ix.programId.toBase58()} is not allowed when unwrapping`);
    }
  }
  if (closes !== 1) errors.push('exactly one close instruction');
  const message = tx.compileMessage();
  for (const s of message.accountKeys.slice(0, message.header.numRequiredSignatures)) {
    if (!s.equals(ctx.relayer) && !s.equals(ctx.user)) errors.push(`unexpected signer ${s.toBase58()}`);
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}

export const RATE_LIMITS = { perTenMinutes: 10, perDay: 60 } as const;

/** Per-user limit on relayer requests, from the counts of the user's recent requests. */
export function rateLimitDecision(counts: { lastTenMinutes: number; lastDay: number }): { ok: true } | { ok: false; message: string } {
  if (counts.lastTenMinutes >= RATE_LIMITS.perTenMinutes) return { ok: false, message: 'Too many requests. Try again in a few minutes.' };
  if (counts.lastDay >= RATE_LIMITS.perDay) return { ok: false, message: 'Daily limit reached. Try again tomorrow.' };
  return { ok: true };
}

export interface SolWrapPlan {
  /** Create the wSOL account first (and close it after the join, returning its rent). */
  createAccount: boolean;
  /** Lamports to move into it (only what's missing for the buy-in). */
  toWrap: bigint;
  /** SOL the user needs right now: the stake still to wrap + the account's refundable rent. */
  required: bigint;
  enough: boolean;
}

/** What a SOL join must wrap, given the user's existing wSOL account and SOL balance. */
export function planSolWrap(i: { buyIn: bigint; accountExists: boolean; wrappedBalance: bigint; accountRent: bigint; solBalance: bigint }): SolWrapPlan {
  const toWrap = i.buyIn > i.wrappedBalance ? i.buyIn - i.wrappedBalance : 0n;
  const required = toWrap + (i.accountExists ? 0n : i.accountRent);
  return { createAccount: !i.accountExists, toWrap, required, enough: i.solBalance >= required };
}
