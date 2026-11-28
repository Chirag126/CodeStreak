import { AddressLookupTableAccount, Keypair, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { ASSOCIATED_TOKEN_PROGRAM_ID, configPda, PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '../program/pdas.js';
import { BATCH_LIMITS, missingTableAddresses, packBatches, v0Footprint, type BatchItem } from './batch.js';

// Instructions shaped exactly like the program's (same accounts, flags and data length), built
// without an RPC. The real program runs these batches in programs/codestreak/tests/batching.rs.
const payer = Keypair.generate().publicKey;
const challenge = Keypair.generate().publicKey;
const vault = Keypair.generate().publicKey;
const usdc = Keypair.generate().publicKey;
const key = () => Keypair.generate().publicKey;
const ix = (keys: [PublicKey, boolean, boolean][], dataLength: number) =>
  new TransactionInstruction({ programId: PROGRAM_ID, keys: keys.map(([pubkey, isSigner, isWritable]) => ({ pubkey, isSigner, isWritable })), data: Buffer.alloc(dataLength, 7) });

/** record_verification(day u16, result enum, evidence_hash [u8; 32]). */
const record = (): BatchItem => ({ instructions: [ix([[payer, true, false], [challenge, false, false], [key(), false, true]], 8 + 2 + 1 + 32)], units: 30_000 });
const finalize = (): BatchItem => ({ instructions: [ix([[challenge, false, true], [key(), false, true]], 8)], units: 30_000 });
const claim = (): BatchItem => ({
  instructions: [ix([[challenge, false, true], [key(), false, true], [usdc, false, false], [key(), false, true], [vault, false, true], [TOKEN_PROGRAM_ID, false, false]], 8)],
  units: 60_000,
});

const table = new AddressLookupTableAccount({
  key: key(),
  state: {
    deactivationSlot: BigInt('0xffffffffffffffff'),
    lastExtendedSlot: 0,
    lastExtendedSlotStartIndex: 0,
    authority: payer,
    addresses: [SystemProgram.programId, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, configPda(), usdc],
  },
});

function check(items: BatchItem[], batches: number[][], tables: AddressLookupTableAccount[]) {
  expect(batches.flat()).toEqual(items.map((_, i) => i)); // every step once, in order
  for (const b of batches) {
    const f = v0Footprint(payer, b.flatMap((i) => items[i]!.instructions), tables)!;
    expect(f.bytes).toBeLessThanOrEqual(BATCH_LIMITS.maxBytes);
    expect(f.accounts).toBeLessThanOrEqual(BATCH_LIMITS.maxAccounts);
  }
}

describe('packBatches', () => {
  it('records 50 player-days in 5 transactions instead of 50', () => {
    const items = Array.from({ length: 50 }, record);
    const batches = packBatches(payer, items, [table]);
    check(items, batches, [table]);
    expect(batches.length).toBeLessThanOrEqual(5);
  });

  it('finalizes 50 players in 3 transactions', () => {
    const items = Array.from({ length: 50 }, finalize);
    const batches = packBatches(payer, items, [table]);
    check(items, batches, [table]);
    expect(batches.length).toBeLessThanOrEqual(3);
  });

  it('pays 50 players in 5 transactions, and the lookup table fits more per transaction', () => {
    const items = Array.from({ length: 50 }, claim);
    const withTable = packBatches(payer, items, [table]);
    const without = packBatches(payer, items, []);
    check(items, withTable, [table]);
    check(items, without, []);
    expect(withTable.length).toBeLessThanOrEqual(5);
    expect(withTable.length).toBeLessThanOrEqual(without.length);
    expect(Math.max(...withTable.map((b) => b.length))).toBeGreaterThan(Math.max(...without.map((b) => b.length)));
  });

  it('respects the compute estimate', () => {
    const items = Array.from({ length: 5 }, () => ({ ...finalize(), units: 500_000 }));
    expect(packBatches(payer, items, [table])).toEqual([[0, 1], [2, 3], [4]]);
  });

  it('gives a step that cannot share a transaction one of its own', () => {
    const big: BatchItem = { instructions: [ix([[challenge, false, true]], 1_100)], units: 10_000 };
    const items = [record(), big, record()];
    expect(packBatches(payer, items, [table])).toEqual([[0], [1], [2]]);
  });

  it('handles no steps', () => {
    expect(packBatches(payer, [], [table])).toEqual([]);
  });
});

describe('v0Footprint', () => {
  it('a looked-up account costs 1 byte instead of 32', () => {
    const items = [claim().instructions[0]!];
    const plain = v0Footprint(payer, items, [])!;
    const looked = v0Footprint(payer, items, [table])!;
    expect(looked.bytes).toBeLessThan(plain.bytes);
    expect(looked.accounts).toBe(plain.accounts);
  });
  it('null when it cannot be encoded at all', () => {
    expect(v0Footprint(payer, [ix([[challenge, false, true]], 3_000)], [])).toBeNull();
  });
});

describe('missingTableAddresses', () => {
  it('only what is not there yet, once each, in order', () => {
    const [a, b, c] = [key(), key(), key()];
    expect(missingTableAddresses([a], [a, b, b, c]).map(String)).toEqual([b, c].map(String));
    expect(missingTableAddresses([a, b], [b, a])).toEqual([]);
  });
});
