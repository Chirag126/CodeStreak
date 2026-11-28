import { Keypair, PublicKey, SystemProgram, Transaction, type SignatureStatus } from '@solana/web3.js';
import { describe, expect, it, vi } from 'vitest';
import { checkRelayedTransaction, COMPUTE_LIMITS } from './index.js';
import {
  computeBudgetInstructions,
  FEE_POLICY,
  planComputeBudget,
  priorityFeeFromSamples,
  priorityFeeLamports,
  recentPriorityFee,
  sendWithResend,
  tightComputeUnits,
  TransactionExpiredError,
  TransactionFailedError,
  TransactionUnconfirmedError,
} from './fast.js';

describe('priorityFeeFromSamples', () => {
  it('uses the floor on a quiet network', () => {
    expect(priorityFeeFromSamples([])).toBe(FEE_POLICY.floorMicroLamports);
    expect(priorityFeeFromSamples([0, 0, 0, 0, 5000])).toBe(FEE_POLICY.floorMicroLamports);
  });
  it('matches the 75th percentile of what was actually paid', () => {
    expect(priorityFeeFromSamples([0, 2000, 4000, 6000, 8000])).toBe(6000);
  });
  it('never goes below the floor or above the cap (and the cap is inside the relayer policy)', () => {
    expect(priorityFeeFromSamples([10, 20, 30, 40])).toBe(FEE_POLICY.floorMicroLamports);
    expect(priorityFeeFromSamples([9e9, 9e9, 9e9])).toBe(FEE_POLICY.capMicroLamports);
    expect(FEE_POLICY.capMicroLamports).toBeLessThanOrEqual(COMPUTE_LIMITS.maxMicroLamports);
  });
  it('ignores junk samples', () => {
    expect(priorityFeeFromSamples([Number.NaN, -5, Infinity, 3000, 3000, 3000])).toBe(3000);
  });
});

describe('tightComputeUnits', () => {
  it('requests what was used plus a margin', () => {
    expect(tightComputeUnits(40_000, 200_000)).toBe(Math.ceil(40_000 * 1.15) + 5_000);
  });
  it('stays within [min, cap] and uses the cap when unknown', () => {
    expect(tightComputeUnits(100, 200_000)).toBe(10_000);
    expect(tightComputeUnits(190_000, 200_000)).toBe(200_000);
    expect(tightComputeUnits(null, 200_000)).toBe(200_000);
    expect(tightComputeUnits(0, 150_000)).toBe(150_000);
  });
  it('makes the priority fee small', () => {
    // 51k units at the floor price: 51 lamports.
    expect(priorityFeeLamports(1_000, 51_000)).toBe(51);
    expect(priorityFeeLamports(FEE_POLICY.capMicroLamports, COMPUTE_LIMITS.maxUnits)).toBe(10_000);
  });
});

describe('compute-budget instructions', () => {
  it('pass the relayer policy at the caps', () => {
    const relayer = Keypair.generate().publicKey;
    const user = Keypair.generate().publicKey;
    const tx = new Transaction({ feePayer: relayer, recentBlockhash: new PublicKey(0).toBase58() }).add(...computeBudgetInstructions(COMPUTE_LIMITS.maxUnits, FEE_POLICY.capMicroLamports));
    const res = checkRelayedTransaction(tx, { relayer, user });
    // No CodeStreak instruction here, so the only complaint must be that one (not the budget).
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors).toEqual(['no CodeStreak instruction']);
  });
});

describe('recentPriorityFee and planComputeBudget', () => {
  const payer = Keypair.generate().publicKey;
  const ix = SystemProgram.transfer({ fromPubkey: payer, toPubkey: Keypair.generate().publicKey, lamports: 1 });

  it('falls back to the floor when the RPC fails', async () => {
    expect(await recentPriorityFee({ getRecentPrioritizationFees: () => Promise.reject(new Error('down')) }, [payer])).toBe(FEE_POLICY.floorMicroLamports);
  });

  it('asks about the writable accounts and plans a tight limit from the simulation', async () => {
    const getRecentPrioritizationFees = vi.fn(async () => [5000, 5000, 7000, 9000].map((f, i) => ({ slot: i, prioritizationFee: f })));
    const simulateTransaction = vi.fn(async () => ({ context: { slot: 1 }, value: { err: null, logs: ['ok'], unitsConsumed: 30_000, accounts: null } }));
    const plan = await planComputeBudget({ getRecentPrioritizationFees, simulateTransaction } as never, { payer, instructions: [ix], cap: 200_000 });
    expect(plan).toMatchObject({ units: Math.ceil(30_000 * 1.15) + 5_000, microLamports: 7000, unitsConsumed: 30_000, err: null });
    const asked = (getRecentPrioritizationFees.mock.calls[0] as unknown as [{ lockedWritableAccounts: PublicKey[] }])[0].lockedWritableAccounts.map((k) => k.toBase58());
    expect(asked).toContain(payer.toBase58());
    expect(simulateTransaction.mock.calls[0]).toBeDefined();
  });

  it('reports a failing simulation and uses the cap when the RPC cannot simulate', async () => {
    const fees = { getRecentPrioritizationFees: async () => [] };
    const failing = await planComputeBudget({ ...fees, simulateTransaction: async () => ({ context: { slot: 1 }, value: { err: { InstructionError: [2, { Custom: 6001 }] }, logs: ['boom'], unitsConsumed: 12_000, accounts: null } }) } as never, { payer, instructions: [ix], cap: 200_000 });
    expect(failing.err).toEqual({ InstructionError: [2, { Custom: 6001 }] });
    expect(failing.logs).toEqual(['boom']);
    const down = await planComputeBudget({ ...fees, simulateTransaction: () => Promise.reject(new Error('rpc down')) } as never, { payer, instructions: [ix], cap: 150_000 });
    expect(down).toMatchObject({ units: 150_000, err: null, microLamports: FEE_POLICY.floorMicroLamports });
  });
});

describe('sendWithResend', () => {
  const status = (s: Partial<SignatureStatus> | null) => ({ context: { slot: 1 }, value: [s as SignatureStatus | null] });
  const clock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms: number) => void (t += ms) };
  };

  it('returns as soon as the transaction is confirmed', async () => {
    const statuses = [status(null), status({ confirmationStatus: 'processed', err: null }), status({ confirmationStatus: 'confirmed', err: null })];
    const rpc = {
      sendRawTransaction: vi.fn(async () => 'sig1'),
      getSignatureStatuses: vi.fn(async () => statuses.shift() ?? status({ confirmationStatus: 'confirmed', err: null })),
      getBlockHeight: vi.fn(async () => 100),
    };
    await expect(sendWithResend(rpc as never, new Uint8Array([1]), { lastValidBlockHeight: 200, ...clock() })).resolves.toBe('sig1');
  });

  it('re-sends the same bytes while unseen, then reports expiry once the blockhash is gone', async () => {
    let height = 100;
    const rpc = {
      sendRawTransaction: vi.fn(async () => 'sig2'),
      getSignatureStatuses: vi.fn(async () => status(null)),
      getBlockHeight: vi.fn(async () => (height += 10)),
    };
    await expect(sendWithResend(rpc as never, new Uint8Array([7, 7]), { lastValidBlockHeight: 150, resendMs: 1000, pollMs: 500, ...clock() })).rejects.toBeInstanceOf(TransactionExpiredError);
    expect(rpc.sendRawTransaction.mock.calls.length).toBeGreaterThan(1);
    for (const call of rpc.sendRawTransaction.mock.calls as unknown as [Buffer][]) expect([...call[0]]).toEqual([7, 7]);
  });

  it('does not call a transaction expired if it landed right at the end', async () => {
    const rpc = {
      sendRawTransaction: vi.fn(async () => 'sig3'),
      getSignatureStatuses: vi.fn(async (_s: string[], o?: { searchTransactionHistory?: boolean }) => (o?.searchTransactionHistory ? status({ confirmationStatus: 'finalized', err: null }) : status(null))),
      getBlockHeight: vi.fn(async () => 999),
    };
    await expect(sendWithResend(rpc as never, new Uint8Array([1]), { lastValidBlockHeight: 150, ...clock() })).resolves.toBe('sig3');
  });

  it('reports an on-chain failure with its error', async () => {
    const rpc = {
      sendRawTransaction: vi.fn(async () => 'sig4'),
      getSignatureStatuses: vi.fn(async () => status({ confirmationStatus: 'confirmed', err: { InstructionError: [0, { Custom: 6010 }] } })),
      getBlockHeight: vi.fn(async () => 100),
    };
    const err = await sendWithResend(rpc as never, new Uint8Array([1]), { lastValidBlockHeight: 150, ...clock() }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransactionFailedError);
    expect((err as Error).message).toContain('"Custom":6010');
  });

  it('keeps waiting for a seen transaction and gives up only after maxWait, as "unknown"', async () => {
    const rpc = {
      sendRawTransaction: vi.fn(async () => 'sig5'),
      getSignatureStatuses: vi.fn(async () => status({ confirmationStatus: 'processed', err: null })),
      getBlockHeight: vi.fn(async () => 9999),
    };
    await expect(sendWithResend(rpc as never, new Uint8Array([1]), { lastValidBlockHeight: 150, maxWaitMs: 5000, ...clock() })).rejects.toBeInstanceOf(TransactionUnconfirmedError);
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });

  it('survives a flaky status endpoint', async () => {
    let n = 0;
    const rpc = {
      sendRawTransaction: vi.fn(async () => 'sig6'),
      getSignatureStatuses: vi.fn(async () => (++n < 3 ? Promise.reject(new Error('503')) : status({ confirmationStatus: 'confirmed', err: null }))),
      getBlockHeight: vi.fn(async () => 100),
    };
    await expect(sendWithResend(rpc as never, new Uint8Array([1]), { lastValidBlockHeight: 150, ...clock() })).resolves.toBe('sig6');
  });
});
