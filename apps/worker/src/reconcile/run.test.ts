import { describe, expect, it } from 'vitest';
import type { Chain, ChainChallenge, ChainParticipant, ChainSponsorReceipt } from '../verify/chain.js';
import type { Db } from '../verify/db.js';
import { reconcileArgs, runReconcile, type ReconcileResult } from './run.js';

const A = 'Cha11enge1111111111111111111111111111111111';
const B = 'Cha11enge2222222222222222222222222222222222';
const GONE = 'Cha11enge3333333333333333333333333333333333';

const challenge = (address: string, o: Partial<ChainChallenge> = {}): ChainChallenge => ({
  address,
  times: { state: 'open', startTs: 1_800_000_000, dayLengthSecs: 600, numDays: 3, joinDeadlineTs: 1_799_999_000, verifyWindowSecs: 900, disputeWindowSecs: 600 },
  participantCount: 1,
  minParticipants: 2,
  mint: 'So11111111111111111111111111111111111111112',
  vault: 'Vau1t11111111111111111111111111111111111111',
  tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  verifier: 'Verifier111111111111111111111111111111111111',
  rulesHash: 'ab'.repeat(32),
  survivorCount: 0,
  fullRefund: false,
  rewardPerSurvivor: 0n,
  rewardDust: 0n,
  survivorsClaimed: 0,
  creator: 'Creator11111111111111111111111111111111111',
  mirror: { onchain_address: address, pool_state: o.times?.state ?? 'open' } as ChainChallenge['mirror'],
  ...o,
});

const player = (o: Partial<ChainParticipant> = {}): ChainParticipant => ({
  address: 'P1',
  user: 'A1ice11111111111111111111111111111111111111',
  deposited: 10n,
  shieldPaid: 0n,
  verifiedDays: 0b001n,
  failedDays: 0b100n,
  indeterminateDays: 0n,
  finalized: false,
  claimed: false,
  status: 'active',
  joinedAt: 1_799_998_000,
  ...o,
});

function fakes(opts: { challenges: ChainChallenge[]; listFails?: boolean; flakyParticipants?: number; sponsors?: ChainSponsorReceipt[]; known: string[] }) {
  let flaky = opts.flakyParticipants ?? 0;
  const calls: Record<string, unknown>[] = [];
  const logs: string[] = [];
  const chain = {
    allChallenges: async () => {
      if (opts.listFails) throw new Error('Invalid account discriminator');
      return opts.challenges;
    },
    challenge: async (a: string) => opts.challenges.find((c) => c.address === a) ?? null,
    participants: async () => {
      if (flaky-- > 0) throw new Error('503 Service Unavailable');
      return [player()];
    },
    sponsorReceipts: async () => opts.sponsors ?? [],
  } as unknown as Chain;
  const db = {
    select: async () => opts.known.map((onchain_address) => ({ onchain_address })),
    rpc: async (_fn: string, args: Record<string, unknown>): Promise<ReconcileResult> => {
      calls.push(args);
      const address = (args.p_chain as { onchain_address: string }).onchain_address;
      return { challenge_id: address, added: address === B, changes: address === A ? ['challenge: participant_count'] : [], warnings: [] };
    },
  } as unknown as Db;
  return { chain, db, calls, logs, deps: { db, chain, log: (m: string) => logs.push(m), retry: { sleep: async () => {}, baseDelayMs: 1 } } };
}

describe('reconcileArgs', () => {
  it('sends each participant with its day results by day index', () => {
    const args = reconcileArgs(challenge(A), [player()], false);
    expect(args.p_chain).toMatchObject({ onchain_address: A, creator: 'Creator11111111111111111111111111111111111' });
    expect(args.p_participants).toEqual([
      { address: 'P1', wallet: 'A1ice11111111111111111111111111111111111111', deposited: '10', status: 'active', finalized: false, claimed: false, joined_at: 1_799_998_000, days: { '0': 'verified', '2': 'failed' } },
    ]);
    expect(args.p_payouts_pending).toBe(false); // still open: nothing owed yet
  });

  it('flags payouts as pending while the chain still owes someone', () => {
    const cancelled = challenge(A, { times: { ...challenge(A).times, state: 'cancelled' } });
    expect(reconcileArgs(cancelled, [player()], false).p_payouts_pending).toBe(true);
    expect(reconcileArgs(cancelled, [player({ claimed: true })], false).p_payouts_pending).toBe(false);
    expect(reconcileArgs(cancelled, [player({ claimed: true })], true).p_payouts_pending).toBe(true); // a sponsor still to refund
  });
});

describe('runReconcile', () => {
  it('reconciles every on-chain challenge and reports database rows missing on-chain', async () => {
    const f = fakes({ challenges: [challenge(A), challenge(B)], known: [A, GONE] });
    const report = await runReconcile(f.deps);
    expect(f.calls).toHaveLength(2);
    expect(report).toMatchObject({ checked: 2, added: 1, fixed: 1 });
    expect(report.warnings).toEqual([`Cha1…3333: in the database but not on devnet`]);
    expect(f.logs).toContain('Cha1…1111: fixed challenge: participant_count');
  });

  it('retries an RPC failure while reading', async () => {
    const f = fakes({ challenges: [challenge(A)], known: [A], flakyParticipants: 2 });
    expect(await runReconcile(f.deps)).toMatchObject({ checked: 1, warnings: [] });
  });

  it("falls back to the database's list when listing every account fails", async () => {
    const f = fakes({ challenges: [challenge(A)], known: [A], listFails: true });
    expect(await runReconcile(f.deps)).toMatchObject({ checked: 1 });
    expect(f.logs[0]).toMatch(/checking the database's challenges one by one/);
  });

  it('checks sponsor refunds only where sponsors are refunded', async () => {
    const settled = challenge(A, { times: { ...challenge(A).times, state: 'settled' }, survivorCount: 1 });
    const f = fakes({ challenges: [settled], known: [A], sponsors: [{ address: 'R', sponsor: 'S', amount: 5n, refunded: false }] });
    await runReconcile(f.deps);
    expect(f.calls[0]?.p_payouts_pending).toBe(false); // sponsorships went to the survivors
  });
});
