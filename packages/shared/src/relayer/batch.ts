// Phase 43 - fewer, smaller transactions.
//
// The worker used to send one transaction per player per step (record a day, finalize, pay out,
// mint a badge). Here those steps are packed into versioned (v0) transactions: as many as fit in
// the 1,232-byte packet, the account-lock limit and a compute budget. Accounts every transaction
// repeats (token programs, the system program, mints, the program config, ...) are read from an
// on-chain address lookup table, so each costs 1 byte instead of 32 and more players fit.
//
// Packing is pure (real serialized sizes, no RPC) and unit-tested.

import { TransactionMessage, VersionedTransaction, type AddressLookupTableAccount, type PublicKey, type TransactionInstruction } from '@solana/web3.js';

import { computeBudgetInstructions, PLACEHOLDER_BLOCKHASH } from './fast.js';

export const BATCH_LIMITS = {
  /** A Solana transaction packet, signatures included. */
  maxBytes: 1_232,
  /** Accounts one transaction may lock (the long-standing network limit). */
  maxAccounts: 64,
  /** Compute units planned per transaction, under the 1.4M maximum (the estimate leaves headroom). */
  maxUnits: 1_200_000,
} as const;

/** The most compute one transaction may request. */
export const MAX_TRANSACTION_UNITS = 1_400_000;

export type BatchLimits = { maxBytes: number; maxAccounts: number; maxUnits: number };

/** One step: instructions that must stay together (e.g. create a token account, then pay into it). */
export interface BatchItem {
  instructions: TransactionInstruction[];
  /** Upper estimate of the compute it uses (the real limit comes from a simulation before sending). */
  units: number;
}

export interface Footprint {
  /** Serialized size, one signature, compute-budget instructions included. */
  bytes: number;
  /** Accounts the transaction locks (static keys + lookups). */
  accounts: number;
}

/**
 * Size of the v0 transaction `payer` would sign for these instructions (with the two compute-budget
 * instructions it always carries). Null if it can't even be encoded (far over the packet size).
 */
export function v0Footprint(payer: PublicKey, instructions: TransactionInstruction[], tables: AddressLookupTableAccount[] = []): Footprint | null {
  try {
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: PLACEHOLDER_BLOCKHASH,
      instructions: [...computeBudgetInstructions(MAX_TRANSACTION_UNITS, 1), ...instructions],
    }).compileToV0Message(tables);
    const bytes = new VersionedTransaction(message).serialize().length;
    const accounts = message.staticAccountKeys.length + message.addressTableLookups.reduce((n, l) => n + l.writableIndexes.length + l.readonlyIndexes.length, 0);
    return { bytes, accounts };
  } catch {
    return null; // web3.js throws when the message overruns the packet buffer
  }
}

/**
 * Splits items into transactions, in order: each transaction takes as many consecutive items as fit
 * (bytes, accounts, compute estimate). Returns item indexes per transaction. An item too big to share
 * a transaction gets one of its own (sending it then reports the real problem).
 */
export function packBatches(payer: PublicKey, items: readonly BatchItem[], tables: AddressLookupTableAccount[] = [], limits: BatchLimits = BATCH_LIMITS): number[][] {
  const fits = (indexes: number[]) => {
    const f = v0Footprint(
      payer,
      indexes.flatMap((i) => items[i]!.instructions),
      tables,
    );
    return !!f && f.bytes <= limits.maxBytes && f.accounts <= limits.maxAccounts;
  };
  const out: number[][] = [];
  let current: number[] = [];
  let units = 0;
  items.forEach((item, i) => {
    if (current.length && units + item.units <= limits.maxUnits && fits([...current, i])) {
      current.push(i);
      units += item.units;
      return;
    }
    if (current.length) out.push(current);
    current = [i];
    units = item.units;
  });
  if (current.length) out.push(current);
  return out;
}

/** Lookup-table addresses to add: those wanted and not yet in the table, de-duplicated, in order. */
export function missingTableAddresses(table: readonly PublicKey[], wanted: readonly PublicKey[]): PublicKey[] {
  const have = new Set(table.map((a) => a.toBase58()));
  const out: PublicKey[] = [];
  for (const a of wanted) {
    const k = a.toBase58();
    if (have.has(k)) continue;
    have.add(k);
    out.push(a);
  }
  return out;
}

/** A lookup table holds at most 256 addresses. */
export const LOOKUP_TABLE_CAPACITY = 256;
