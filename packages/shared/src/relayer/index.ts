// Relayer rules (pure): what the CodeStreak relayer will pay fees for and co-sign. Used by the web
// server before it pre-signs and again before it submits. Import from "@codestreak/shared/relayer".
import { PublicKey, TransactionInstruction, type Transaction } from '@solana/web3.js';

import { CODESTREAK_IDL_JSON } from '../program/idl/codestreak.idl.js';
import { PROGRAM_ID } from '../program/pdas.js';

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
 * program-ID placeholder for an absent optional account). Args: only u64 amounts are needed here.
 */
export function buildCodestreakInstruction(
  name: RelayedInstruction,
  accounts: Record<string, PublicKey | null | undefined>,
  args: { amount?: bigint } = {},
  programId: PublicKey = PROGRAM_ID,
): TransactionInstruction {
  const idl = byName.get(name);
  if (!idl) throw new Error(`unknown instruction ${name}`);
  const keys = accountsOf(idl).map((a) => {
    const value = accounts[a.name] ?? (a.address ? new PublicKey(a.address) : null);
    if (!value) {
      if (a.optional) return { pubkey: programId, isSigner: false, isWritable: false };
      throw new Error(`${name}: missing account ${a.name}`);
    }
    return { pubkey: value, isSigner: Boolean(a.signer), isWritable: Boolean(a.writable) };
  });
  const parts: Uint8Array[] = [Uint8Array.from(idl.discriminator)];
  for (const arg of idl.args as unknown as { name: string; type: string }[]) {
    if (arg.type !== 'u64' || arg.name !== 'amount' || args.amount === undefined) throw new Error(`${name}: unsupported argument ${arg.name}`);
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setBigUint64(0, args.amount, true);
    parts.push(buf);
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

export interface PolicyContext {
  relayer: PublicKey;
  /** The user's linked wallet: the only other key allowed to sign. */
  user: PublicKey;
  programId?: PublicKey;
  allowed?: readonly RelayedInstruction[];
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

export const RATE_LIMITS = { perTenMinutes: 10, perDay: 60 } as const;

/** Per-user limit on relayer requests, from the counts of the user's recent requests. */
export function rateLimitDecision(counts: { lastTenMinutes: number; lastDay: number }): { ok: true } | { ok: false; message: string } {
  if (counts.lastTenMinutes >= RATE_LIMITS.perTenMinutes) return { ok: false, message: 'Too many requests. Try again in a few minutes.' };
  if (counts.lastDay >= RATE_LIMITS.perDay) return { ok: false, message: 'Daily limit reached. Try again tomorrow.' };
  return { ok: true };
}
