import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import { challengePda, participantPda, PROGRAM_ID, vaultPda } from '../program/pdas.js';
import {
  buildCodestreakInstruction,
  checkRelayedTransaction,
  checkUnwrapTransaction,
  closeWrappedSolAccountInstruction,
  decodeInstructionName,
  rateLimitDecision,
  RATE_LIMITS,
} from './index.js';

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const relayer = Keypair.generate().publicKey;
const user = Keypair.generate().publicKey;
const attacker = Keypair.generate().publicKey;
const challenge = challengePda(Keypair.generate().publicKey, 1n);
const mint = Keypair.generate().publicKey;
const userToken = Keypair.generate().publicKey;

function joinIx(overrides: Record<string, PublicKey | null> = {}) {
  return buildCodestreakInstruction('join_pool', {
    payer: relayer,
    user,
    join_authority: null,
    challenge,
    participant: participantPda(challenge, user),
    mint,
    user_token: userToken,
    vault: vaultPda(challenge),
    token_program: TOKEN_PROGRAM,
    ...overrides,
  });
}

function tx(...ixs: TransactionInstruction[]) {
  const t = new Transaction({ feePayer: relayer, recentBlockhash: '11111111111111111111111111111111' });
  t.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 120_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }), ...ixs);
  return t;
}

/** SPL Token `Transfer` (instruction 3): move tokens from the user's account to an attacker. */
function tokenTransfer(from: PublicKey, to: PublicKey, owner: PublicKey) {
  const data = Buffer.alloc(9);
  data[0] = 3;
  data.writeBigUInt64LE(1_000_000n, 1);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [
      { pubkey: from, isSigner: false, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

const ctx = { relayer, user };

describe('relayer policy', () => {
  it('accepts a sponsored join', () => {
    expect(checkRelayedTransaction(tx(joinIx()), ctx)).toEqual({ ok: true, instruction: 'join_pool' });
    expect(decodeInstructionName(joinIx().data)).toBe('join_pool');
  });

  it('accepts a private join co-signed by the relayer', () => {
    expect(checkRelayedTransaction(tx(joinIx({ join_authority: relayer })), ctx)).toMatchObject({ ok: true });
  });

  it('rejects an attacker token transfer added to the transaction', () => {
    const r = checkRelayedTransaction(tx(joinIx(), tokenTransfer(userToken, attacker, user)), ctx);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join()).toMatch(/TokenkegQ.* is not allowed/);
  });

  it('rejects draining the relayer with a SOL transfer', () => {
    const r = checkRelayedTransaction(tx(joinIx(), SystemProgram.transfer({ fromPubkey: relayer, toPubkey: attacker, lamports: 1_000_000_000 })), ctx);
    expect(r.ok).toBe(false);
  });

  it('rejects instructions the relayer does not sponsor, and two program instructions', () => {
    const adminLike = new TransactionInstruction({ programId: PROGRAM_ID, keys: [], data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) });
    expect(checkRelayedTransaction(tx(adminLike), ctx).ok).toBe(false);
    expect(checkRelayedTransaction(tx(joinIx(), joinIx()), ctx).ok).toBe(false);
    expect(checkRelayedTransaction(tx(), ctx).ok).toBe(false);
  });

  it('rejects the relayer in a user slot, a foreign co-signer, someone else as the user, or another fee payer', () => {
    expect(checkRelayedTransaction(tx(joinIx({ user: relayer })), ctx).ok).toBe(false);
    expect(checkRelayedTransaction(tx(joinIx({ join_authority: attacker })), ctx).ok).toBe(false);
    expect(checkRelayedTransaction(tx(joinIx({ user: attacker })), ctx).ok).toBe(false);
    const t = tx(joinIx());
    t.feePayer = user;
    expect(checkRelayedTransaction(t, ctx).ok).toBe(false);
  });

  it('caps compute budget and priority fees', () => {
    const t = new Transaction({ feePayer: relayer, recentBlockhash: '11111111111111111111111111111111' });
    t.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000_000 }), joinIx());
    expect(checkRelayedTransaction(t, ctx)).toMatchObject({ ok: false, errors: ['priority fee above the relayer cap'] });
    const t2 = new Transaction({ feePayer: relayer, recentBlockhash: '11111111111111111111111111111111' });
    t2.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), joinIx());
    expect(checkRelayedTransaction(t2, ctx).ok).toBe(false);
  });

  it('encodes u64 arguments from the IDL', () => {
    const ix = buildCodestreakInstruction('sponsor_pool', {
      payer: relayer,
      sponsor: user,
      challenge,
      receipt: Keypair.generate().publicKey,
      mint,
      sponsor_token: userToken,
      vault: vaultPda(challenge),
      token_program: TOKEN_PROGRAM,
    }, { amount: 2_500_000n });
    expect(ix.data.length).toBe(16);
    expect(ix.data.readBigUInt64LE(8)).toBe(2_500_000n);
  });
});

describe('rate limits', () => {
  it('rejects requests over the per-user limits', () => {
    expect(rateLimitDecision({ lastTenMinutes: 0, lastDay: 0 })).toEqual({ ok: true });
    expect(rateLimitDecision({ lastTenMinutes: RATE_LIMITS.perTenMinutes - 1, lastDay: 5 })).toEqual({ ok: true });
    expect(rateLimitDecision({ lastTenMinutes: RATE_LIMITS.perTenMinutes, lastDay: 10 })).toMatchObject({ ok: false });
    expect(rateLimitDecision({ lastTenMinutes: 0, lastDay: RATE_LIMITS.perDay })).toMatchObject({ ok: false });
  });
});

describe('SOL join: wrap in the same transaction', () => {
  // Imported lazily to keep the earlier tests' imports unchanged.
  const load = () => import('./index.js');
  const wsolAccount = Keypair.generate().publicKey;
  const BUY_IN = 100_000_000n; // 0.1 SOL
  const wrap = { account: wsolAccount, maxLamports: BUY_IN };
  const solJoin = () => joinIx({ user_token: wsolAccount });

  it('accepts create → transfer → sync → join → close for the user own wSOL account', async () => {
    const m = await load();
    const t = tx(
      m.createWrappedSolAccountInstruction(user, wsolAccount),
      ...m.wrapSolInstructions(user, wsolAccount, BUY_IN),
      solJoin(),
      m.closeWrappedSolAccountInstruction(user, wsolAccount),
    );
    expect(checkRelayedTransaction(t, { ...ctx, wrap })).toEqual({ ok: true, instruction: 'join_pool' });
  });

  it('rejects wrap instructions when no SOL stake is involved', async () => {
    const m = await load();
    expect(checkRelayedTransaction(tx(...m.wrapSolInstructions(user, wsolAccount, BUY_IN), solJoin()), ctx).ok).toBe(false);
  });

  it('rejects SOL sent anywhere but the wSOL account, or more than the buy-in', async () => {
    const m = await load();
    expect(checkRelayedTransaction(tx(SystemProgram.transfer({ fromPubkey: user, toPubkey: attacker, lamports: 1n }), solJoin()), { ...ctx, wrap }).ok).toBe(false);
    expect(checkRelayedTransaction(tx(...m.wrapSolInstructions(user, wsolAccount, BUY_IN + 1n), solJoin()), { ...ctx, wrap }).ok).toBe(false);
    expect(checkRelayedTransaction(tx(SystemProgram.transfer({ fromPubkey: relayer, toPubkey: wsolAccount, lamports: BUY_IN }), solJoin()), { ...ctx, wrap }).ok).toBe(false);
  });

  it('rejects the relayer paying for the wSOL account, closing to an attacker, and wrong order', async () => {
    const m = await load();
    expect(checkRelayedTransaction(tx(m.createWrappedSolAccountInstruction(relayer, wsolAccount), solJoin()), { ...ctx, wrap }).ok).toBe(false);
    const steal = m.closeWrappedSolAccountInstruction(user, wsolAccount);
    steal.keys[1] = { pubkey: attacker, isSigner: false, isWritable: true };
    expect(checkRelayedTransaction(tx(...m.wrapSolInstructions(user, wsolAccount, BUY_IN), solJoin(), steal), { ...ctx, wrap }).ok).toBe(false);
    // Wrapping after the join, or closing before it, is refused.
    expect(checkRelayedTransaction(tx(solJoin(), ...m.wrapSolInstructions(user, wsolAccount, BUY_IN)), { ...ctx, wrap }).ok).toBe(false);
    expect(checkRelayedTransaction(tx(m.closeWrappedSolAccountInstruction(user, wsolAccount), solJoin()), { ...ctx, wrap }).ok).toBe(false);
  });

  it('still rejects an attacker token transfer in a SOL join', () => {
    expect(checkRelayedTransaction(tx(solJoin(), tokenTransfer(wsolAccount, attacker, user)), { ...ctx, wrap }).ok).toBe(false);
  });
});

describe('SOL wrap plan (insufficient balance handled before anything is signed)', () => {
  it('wraps the whole stake into a new account, and needs its refundable rent too', async () => {
    const { planSolWrap } = await import('./index.js');
    expect(planSolWrap({ buyIn: 100n, accountExists: false, wrappedBalance: 0n, accountRent: 20n, solBalance: 120n })).toEqual({
      createAccount: true,
      toWrap: 100n,
      required: 120n,
      enough: true,
    });
    expect(planSolWrap({ buyIn: 100n, accountExists: false, wrappedBalance: 0n, accountRent: 20n, solBalance: 119n }).enough).toBe(false);
  });

  it('uses wSOL the user already has and wraps only the rest', async () => {
    const { planSolWrap } = await import('./index.js');
    expect(planSolWrap({ buyIn: 100n, accountExists: true, wrappedBalance: 70n, accountRent: 20n, solBalance: 30n })).toMatchObject({ toWrap: 30n, required: 30n, enough: true });
    expect(planSolWrap({ buyIn: 100n, accountExists: true, wrappedBalance: 150n, accountRent: 20n, solBalance: 0n })).toMatchObject({ toWrap: 0n, enough: true, createAccount: false });
  });
});

describe('unwrap (Phase 30): the relayer only pays the fee to close your own wSOL account', () => {
  const account = Keypair.generate().publicKey;
  const ctx = { relayer, user, account };

  it('accepts closing your wSOL account to your wallet', () => {
    expect(checkUnwrapTransaction(tx(closeWrappedSolAccountInstruction(user, account)), ctx)).toEqual({ ok: true });
  });
  it('rejects sending the SOL to someone else, closing another account, or no owner signature', () => {
    const toAttacker = new TransactionInstruction({
      programId: TOKEN_PROGRAM,
      keys: [
        { pubkey: account, isSigner: false, isWritable: true },
        { pubkey: attacker, isSigner: false, isWritable: true },
        { pubkey: user, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([9]),
    });
    expect(checkUnwrapTransaction(tx(toAttacker), ctx)).toMatchObject({ ok: false, errors: ['close: the SOL must go to your own wallet'] });
    expect(checkUnwrapTransaction(tx(closeWrappedSolAccountInstruction(user, userToken)), ctx)).toMatchObject({ ok: false, errors: ['close: only your own wrapped SOL account'] });
  });
  it('rejects anything added: a transfer, a second close, a program instruction', () => {
    const drain = SystemProgram.transfer({ fromPubkey: relayer, toPubkey: attacker, lamports: 1_000_000 });
    expect(checkUnwrapTransaction(tx(closeWrappedSolAccountInstruction(user, account), drain), ctx).ok).toBe(false);
    expect(checkUnwrapTransaction(tx(closeWrappedSolAccountInstruction(user, account), closeWrappedSolAccountInstruction(user, account)), ctx)).toMatchObject({
      ok: false,
      errors: ['exactly one close instruction'],
    });
    expect(checkUnwrapTransaction(tx(closeWrappedSolAccountInstruction(user, account), joinIx()), ctx).ok).toBe(false);
  });
  it('rejects another fee payer', () => {
    const t = tx(closeWrappedSolAccountInstruction(user, account));
    t.feePayer = user;
    expect(checkUnwrapTransaction(t, ctx)).toMatchObject({ ok: false, errors: ['the relayer must be the fee payer'] });
  });
});

describe('activate_shield (Phase 32)', () => {
  it('encodes the day as u16 and passes the relayer policy as the fee payer', () => {
    const challenge = Keypair.generate().publicKey;
    const ix = buildCodestreakInstruction(
      'activate_shield',
      { payer: relayer, user, challenge, participant: Keypair.generate().publicKey, mint: Keypair.generate().publicKey, user_token: userToken, vault: Keypair.generate().publicKey, token_program: TOKEN_PROGRAM },
      { day: 2 },
    );
    expect(Array.from(ix.data.subarray(8))).toEqual([2, 0]);
    expect(decodeInstructionName(ix.data)).toBe('activate_shield');
    expect(checkRelayedTransaction(tx(ix), { relayer, user, allowed: ['activate_shield'] }).ok).toBe(true);
    expect(checkRelayedTransaction(tx(ix), { relayer, user, allowed: ['join_pool'] }).ok).toBe(false);
  });
  it('rejects a day that is not a u16', () => {
    expect(() => buildCodestreakInstruction('activate_shield', {}, { day: -1 })).toThrow();
  });
});
