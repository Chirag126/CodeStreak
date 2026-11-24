import { describe, expect, it } from 'vitest';
import type { ProviderEvaluation } from '@codestreak/shared';
import { dayResultOf, type Chain, type ChainChallenge, type ChainParticipant, type ChainSponsorReceipt, type DayResultName } from './chain.js';
import type { Db } from './db.js';
import type { DayEvaluation } from './evaluate.js';
import { participantPayout, runVerification, type VerifyDeps } from './run.js';
import { dueDays, recordDelaySecs } from './schedule.js';

// ------------------------------------------------------------------ fakes

const CHALLENGE = 'Cha11enge1111111111111111111111111111111111';
const VERIFIER = 'Verifier111111111111111111111111111111111111';
const ALICE = 'A1ice11111111111111111111111111111111111111';
const BOB = 'Bob1111111111111111111111111111111111111111';
const START = 1_800_000_000;
const DAY = 600; // a 10-minute demo day

/** An in-memory program that enforces the rules the worker relies on. */
class FakeChain implements Chain {
  verifier = VERIFIER;
  clock = START;
  c: ChainChallenge;
  ps = new Map<string, ChainParticipant>();
  sponsors = new Map<string, ChainSponsorReceipt>();
  sent: string[] = [];
  /** Fail the next N calls of a method with this error (before or after the change lands). */
  faults: { method: string; error: Error; landed: boolean; times: number }[] = [];

  constructor(players: string[], over: Partial<ChainChallenge['times']> = {}) {
    this.c = {
      address: CHALLENGE,
      times: { state: 'open', startTs: START, dayLengthSecs: DAY, numDays: 3, joinDeadlineTs: START - 60, verifyWindowSecs: 900, disputeWindowSecs: 600, ...over },
      participantCount: players.length,
      minParticipants: 2,
      mint: 'So11111111111111111111111111111111111111112',
      vault: 'Vau1t11111111111111111111111111111111111111',
      tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      verifier: VERIFIER,
      rulesHash: 'ab'.repeat(32),
      survivorCount: 0,
      fullRefund: false,
      rewardPerSurvivor: 0n,
      rewardDust: 0n,
      survivorsClaimed: 0,
      creator: VERIFIER,
      mirror: {} as ChainChallenge['mirror'], // only passed through to reconcile_challenge
    };
    for (const u of players) {
      this.ps.set(`P-${u}`, { address: `P-${u}`, user: u, deposited: 10n, shieldPaid: 0n, verifiedDays: 0n, failedDays: 0n, indeterminateDays: 0n, shieldedDays: 0n, finalized: false, claimed: false, status: 'active', joinedAt: START - 100 });
    }
  }
  private tx(what: string, apply: () => void): Promise<string> {
    const fault = this.faults.find((f) => f.method === what.split(':')[0] && f.times > 0);
    if (fault) {
      fault.times--;
      if (fault.landed) apply();
      return Promise.reject(fault.error);
    }
    apply();
    const sig = `sig-${this.sent.length + 1}`;
    this.sent.push(`${what}`);
    return Promise.resolve(sig);
  }
  async now() {
    return this.clock;
  }
  async challenge() {
    return structuredClone(this.c);
  }
  async allChallenges() {
    return [structuredClone(this.c)];
  }
  async participants() {
    return [...this.ps.values()].map((p) => ({ ...p }));
  }
  async participant(a: string) {
    const p = this.ps.get(a);
    return p ? { ...p } : null;
  }
  async sponsorReceipts() {
    return [...this.sponsors.values()].map((r) => ({ ...r }));
  }
  async sponsorReceipt(a: string) {
    const r = this.sponsors.get(a);
    return r ? { ...r } : null;
  }
  recordVerification(_c: string, participant: string, day: number, result: DayResultName) {
    const p = this.ps.get(participant)!;
    const before = dayResultOf(p, day);
    // The program: none -> any; failed/indeterminate -> verified (an upgrade, until the dispute window ends).
    if (before && !(result === 'verified' && before !== 'verified')) return Promise.reject(new Error('custom program error: 0x1780 InvalidTransition'));
    return this.tx(`record:${p.user}:${day}:${result}`, () => {
      const bit = 1n << BigInt(day);
      p.failedDays &= ~bit;
      p.indeterminateDays &= ~bit;
      if (result === 'verified') p.verifiedDays |= bit;
      else if (result === 'failed') p.failedDays |= bit;
      else p.indeterminateDays |= bit;
    });
  }
  cancel() {
    return this.tx('cancel', () => void (this.c.times.state = 'cancelled'));
  }
  finalize(_c: string, participant: string) {
    const p = this.ps.get(participant)!;
    return this.tx(`finalize:${p.user}`, () => {
      p.finalized = true;
      // rules.rs finalize_outcome: a Shield covers its day whatever was recorded.
      const all = (1n << BigInt(this.c.times.numDays)) - 1n;
      const uncoveredFailures = p.failedDays & ~p.shieldedDays & all;
      const covered = (p.verifiedDays | p.shieldedDays) & all;
      p.status = uncoveredFailures ? 'failed' : covered === all ? 'survived' : 'voided';
      if (p.status === 'survived') this.c.survivorCount++;
    });
  }
  settle() {
    return this.tx('settle', () => {
      this.c.times.state = 'settled';
      const ps = [...this.ps.values()];
      const s = BigInt(this.c.survivorCount);
      if (!s) this.c.fullRefund = true;
      else {
        const pool = ps.filter((p) => p.status === 'failed').reduce((a, p) => a + p.deposited, 0n);
        this.c.rewardPerSurvivor = pool / s;
        this.c.rewardDust = pool % s;
      }
    });
  }
  claimParticipant(_c: ChainChallenge, p: ChainParticipant, kind: 'reward' | 'refund') {
    const live = this.ps.get(p.address)!;
    if (live.claimed) return Promise.reject(new Error('custom program error: AlreadyClaimed'));
    return this.tx(`${kind}:${p.user}`, () => {
      live.claimed = true;
      if (kind === 'reward') this.c.survivorsClaimed++;
    });
  }
  claimSponsorRefund(_c: ChainChallenge, r: ChainSponsorReceipt) {
    return this.tx(`sponsor_refund:${r.sponsor}`, () => void (this.sponsors.get(r.address)!.refunded = true));
  }
}

/** The SQL functions the job calls, in memory. */
class FakeDb implements Db {
  lease = new Set<string>();
  runs: { id: string; status?: string; error?: string | null }[] = [];
  dayResults = new Map<string, { membership_id: string; day: number; result: DayResultName; evidence_hash: string; onchain_at: string | null; record_tx: string | null }>();
  payouts: { wallet: string; kind: string; amount: string; tx: string | null }[] = [];
  poolState = 'open';
  payoutsDone: string | null = null;
  members = [
    { id: 'm-alice', profile_id: 'pr-alice', wallet_address: ALICE, participant_address: `P-${ALICE}`, claimed_at: null as string | null },
    { id: 'm-bob', profile_id: 'pr-bob', wallet_address: BOB, participant_address: null, claimed_at: null as string | null },
  ];
  work = [{ challenge_id: 'c1', address: CHALLENGE, reason: 'record' }];
  reconciled: Record<string, unknown>[] = [];
  disputes: { id: string; day: number; previous_hash: string; review_note: string; reviewed_at: string; memberships: { wallet_address: string; challenge_id: string } }[] = [];
  disputeCalls: Record<string, unknown>[] = [];

  async rpc<T>(fn: string, a: Record<string, unknown> = {}): Promise<T> {
    switch (fn) {
      case 'verification_work':
        return this.work as T;
      case 'begin_verification_run': {
        if (this.lease.has(a.p_challenge as string)) return null as T;
        this.lease.add(a.p_challenge as string);
        const id = `run-${this.runs.length + 1}`;
        this.runs.push({ id });
        return id as T;
      }
      case 'finish_verification_run': {
        const r = this.runs.find((x) => x.id === a.p_run)!;
        Object.assign(r, { status: a.p_status, error: a.p_error });
        this.lease.clear();
        return null as T;
      }
      case 'save_day_result': {
        const key = `${a.p_membership}:${a.p_day}`;
        const found = this.dayResults.get(key);
        if (found) return [{ result: found.result, evidence_hash: found.evidence_hash, cached: true }] as T;
        this.dayResults.set(key, { membership_id: a.p_membership as string, day: a.p_day as number, result: a.p_result as DayResultName, evidence_hash: a.p_hash as string, onchain_at: null, record_tx: null });
        return [{ result: a.p_result, evidence_hash: a.p_hash, cached: false }] as T;
      }
      case 'mark_day_recorded': {
        const r = this.dayResults.get(`${a.p_membership}:${a.p_day}`);
        if (r && !r.onchain_at) Object.assign(r, { onchain_at: 'now', record_tx: r.record_tx ?? a.p_tx });
        return null as T;
      }
      case 'mirror_pool_state':
        this.poolState = a.p_state as string;
        return null as T;
      case 'resolve_dispute':
      case 'close_dispute':
        this.disputeCalls.push({ fn, ...a });
        this.disputes = this.disputes.filter((d) => d.id !== a.p_dispute);
        return null as T;
      case 'reconcile_challenge':
        this.reconciled.push(a);
        return { challenge_id: 'c1', added: false, changes: [], warnings: [] } as T;
      case 'record_payout':
        this.payouts.push({ wallet: a.p_wallet as string, kind: a.p_kind as string, amount: a.p_amount as string, tx: a.p_tx as string | null });
        return null as T;
    }
    throw new Error(`unexpected rpc ${fn}`);
  }
  async select<T>(table: string): Promise<T[]> {
    if (table === 'challenges') return [{ id: 'c1', rules: { providers: ['github'], github: { minMeaningfulLines: 10 } }, payouts_done_at: this.payoutsDone }] as T[];
    if (table === 'memberships') return this.members as T[];
    if (table === 'day_results') return [...this.dayResults.values()] as T[];
    if (table === 'disputes') return this.disputes as T[];
    throw new Error(`unexpected select ${table}`);
  }
  async insert() {}
  async update(table: string, _f: string, patch: Record<string, unknown>) {
    if (table === 'challenges') this.payoutsDone = patch.payouts_done_at as string;
  }
}

const met = (value = 25): ProviderEvaluation => ({ provider: 'github', outcome: 'met', value, goal: 10, quality: { complete: true, gaps: 0, coveragePct: 100 }, evidence: [] });
const notMet: ProviderEvaluation = { provider: 'github', outcome: 'not_met', value: 0, goal: 10, quality: { complete: true, gaps: 0, coveragePct: 100 }, evidence: [] };

function setup(players = [ALICE, BOB], over: Partial<ChainChallenge['times']> = {}) {
  const chain = new FakeChain(players, over);
  const db = new FakeDb();
  const evaluations: string[] = [];
  let outcome: (profile: string, day: number) => DayEvaluation = () => ({ providers: [met()], evidence: [], transientFailure: null });
  const logs: string[] = [];
  const deps: VerifyDeps = {
    db,
    chain,
    log: (m) => logs.push(m),
    evaluate: async ({ profileId, day }) => {
      evaluations.push(`${profileId}:${day}`);
      return outcome(profileId, day);
    },
    retry: { sleep: async () => {}, baseDelayMs: 1 },
  };
  return { chain, db, deps, evaluations, logs, setOutcome: (f: typeof outcome) => (outcome = f) };
}

/** Runs the job once and returns the (single) challenge's report. */
async function one(deps: VerifyDeps) {
  const report = (await runVerification(deps)).challenges[0];
  if (!report) throw new Error('the run processed no challenge');
  return report;
}

// ------------------------------------------------------------------ tests

describe('schedule', () => {
  it('records a day a quarter-day after it ends (1 to 45 min), never past the verification window', () => {
    expect(recordDelaySecs(600, 1e6)).toBe(150);
    expect(recordDelaySecs(86_400, 1e6)).toBe(2700);
    expect(recordDelaySecs(86_400, 600)).toBe(480);
    const t = { state: 'open' as const, startTs: START, dayLengthSecs: DAY, numDays: 3, joinDeadlineTs: START, verifyWindowSecs: 900, disputeWindowSecs: 600 };
    expect(dueDays(t, START + DAY + 149)).toEqual([]);
    expect(dueDays(t, START + DAY + 150)).toEqual([0]);
    expect(dueDays(t, START + 3 * DAY + 150)).toEqual([0, 1, 2]);
    expect(dueDays(t, START + 3 * DAY + 900)).toEqual([]); // verification window closed
  });
});

describe('verification job', () => {
  it("records a demo challenge's finished days for every player, mirrored to the database", async () => {
    const { chain, db, deps } = setup();
    chain.clock = START + 2 * DAY + 200; // days 1 and 2 over
    const report = await one(deps);

    expect(chain.sent.sort()).toEqual([`record:${ALICE}:0:verified`, `record:${ALICE}:1:verified`, `record:${BOB}:0:verified`, `record:${BOB}:1:verified`].sort());
    expect(report).toMatchObject({ recorded: 4, cached: 0, errors: [] });
    expect([...db.dayResults.values()].every((r) => r.onchain_at && r.record_tx?.startsWith('sig-'))).toBe(true);
    expect(db.runs[0]).toMatchObject({ status: 'succeeded', error: null });
    expect(db.reconciled).toHaveLength(1); // the mirror is reconciled after every run
  });

  it('a duplicate run sends no duplicate transaction and re-evaluates nothing', async () => {
    const { chain, deps, evaluations } = setup();
    chain.clock = START + 2 * DAY + 200;
    await runVerification(deps);
    const sent = chain.sent.length;
    const evaluated = evaluations.length;
    const again = await one(deps);
    expect(chain.sent.length).toBe(sent);
    expect(evaluations.length).toBe(evaluated);
    expect(again).toMatchObject({ recorded: 0, txs: [] });
  });

  it('skips a challenge another run holds the lease for', async () => {
    const { chain, db, deps, logs } = setup();
    chain.clock = START + 2 * DAY + 200;
    db.lease.add('c1');
    expect((await runVerification(deps)).challenges).toEqual([]);
    expect(chain.sent).toEqual([]);
    expect(logs.join('\n')).toMatch(/another run is working on this challenge/);
  });

  it('retries an RPC failure and sends the transaction once', async () => {
    const { chain, deps, logs } = setup([ALICE, BOB]);
    chain.clock = START + DAY + 200;
    chain.faults.push({ method: 'record', error: new Error('503 Service Unavailable'), landed: false, times: 2 });
    const report = await one(deps);
    expect(report).toMatchObject({ recorded: 2, errors: [] });
    expect(chain.sent.filter((s) => s.startsWith('record:'))).toHaveLength(2);
    expect(logs.filter((l) => /attempt \d failed .*503/.test(l))).toHaveLength(2);
  });

  it('a lost confirmation is not re-sent: the retry sees the result on-chain', async () => {
    const { chain, db, deps } = setup([ALICE]);
    chain.c.minParticipants = 1;
    chain.clock = START + DAY + 200;
    // The transaction lands, but the RPC times out before confirming it.
    chain.faults.push({ method: 'record', error: new Error('Transaction was not confirmed in 30.00 seconds'), landed: true, times: 1 });
    const report = await one(deps);
    expect(report.errors).toEqual([]);
    expect(dayResultOf(chain.ps.get(`P-${ALICE}`)!, 0)).toBe('verified');
    expect(db.dayResults.get('m-alice:0')?.onchain_at).toBeTruthy();
  });

  it('a program error is final (not retried) and the stored result is reused next time', async () => {
    const { chain, db, deps, evaluations } = setup([ALICE]);
    chain.c.minParticipants = 1;
    chain.clock = START + DAY + 200;
    chain.faults.push({ method: 'record', error: new Error('custom program error: 0x1777 VerificationWindowClosed'), landed: false, times: 1 });
    const first = await one(deps);
    expect(first.errors[0]).toMatch(/day 1 for A1ic/);
    expect(db.runs[0]?.status).toBe('partial');
    expect(db.dayResults.get('m-alice:0')?.onchain_at).toBeNull();

    const second = await one(deps);
    expect(second).toMatchObject({ recorded: 1, cached: 1, errors: [] });
    expect(evaluations).toEqual(['pr-alice:0']); // evaluated once; the receipt hash is reused
  });

  it('defers a day when a provider is unreachable, and records it on the last call', async () => {
    const { chain, deps, setOutcome } = setup([ALICE]);
    chain.c.minParticipants = 1;
    setOutcome(() => ({ providers: [{ ...notMet, outcome: 'unknown', quality: { complete: false, gaps: 0, coveragePct: 0 } }], evidence: [], transientFailure: 'GitHub: 502' }));
    chain.clock = START + DAY + 200;
    const first = await one(deps);
    expect(first).toMatchObject({ deferred: 1, recorded: 0 });

    chain.clock = START + 3 * DAY + 900 - 100; // 100 s before the verification window closes
    const last = await one(deps);
    expect(last.recorded).toBe(3);
    expect(chain.sent).toEqual([`record:${ALICE}:0:indeterminate`, `record:${ALICE}:1:indeterminate`, `record:${ALICE}:2:indeterminate`]);
  });

  it('records "could not verify" for a wallet with no CodeStreak account', async () => {
    const { chain, deps, evaluations } = setup([ALICE, 'Stranger11111111111111111111111111111111111']);
    chain.clock = START + DAY + 200;
    await runVerification(deps);
    expect(chain.sent).toContain('record:Stranger11111111111111111111111111111111111:0:indeterminate');
    expect(evaluations).toEqual(['pr-alice:0']);
  });

  it('settles: finalizes everyone, settles, pays survivors (dust to the last) and mirrors it', async () => {
    const { chain, db, deps, setOutcome } = setup([ALICE, BOB, 'Caro11111111111111111111111111111111111111']);
    db.members.push({ id: 'm-caro', profile_id: 'pr-caro', wallet_address: 'Caro11111111111111111111111111111111111111', participant_address: null, claimed_at: null });
    setOutcome((profile) => ({ providers: [profile === 'pr-caro' ? notMet : met()], evidence: [], transientFailure: null }));
    chain.clock = START + 3 * DAY + 200;
    await runVerification(deps); // all three days recorded
    chain.clock = START + 3 * DAY + 900 + 600; // dispute window over
    const report = await one(deps);

    expect(report.errors).toEqual([]);
    expect(chain.c.times.state).toBe('settled');
    expect(db.poolState).toBe('settled');
    const rewards = db.payouts.filter((p) => p.kind === 'reward');
    expect(rewards.map((p) => p.wallet).sort()).toEqual([ALICE, BOB].sort());
    // Caro's 10 split between 2 survivors: 10 + 5 each, no dust.
    expect(rewards.map((p) => p.amount)).toEqual(['15', '15']);
    expect(db.payouts.some((p) => p.wallet.startsWith('Caro'))).toBe(false);
    expect(db.payoutsDone).toBeTruthy();

    const sent = chain.sent.length;
    await runVerification(deps);
    expect(chain.sent.length).toBe(sent); // nothing paid twice
  });

  it('a Shield covers a missed demo day: the shielded player survives and is paid', async () => {
    const { chain, db, deps, setOutcome } = setup([ALICE, BOB]);
    // Both miss day 3; only Alice bought a Shield for it.
    setOutcome((_profile, day) => ({ providers: [day === 2 ? notMet : met()], evidence: [], transientFailure: null }));
    chain.ps.get(`P-${ALICE}`)!.shieldedDays = 0b100n;
    chain.ps.get(`P-${ALICE}`)!.shieldPaid = 2n;
    chain.clock = START + 3 * DAY + 200;
    await runVerification(deps); // days recorded: day 3 failed for both
    expect(dayResultOf(chain.ps.get(`P-${ALICE}`)!, 2)).toBe('failed');
    chain.clock = START + 3 * DAY + 900 + 600;
    await runVerification(deps);
    expect(chain.ps.get(`P-${ALICE}`)!.status).toBe('survived');
    expect(chain.ps.get(`P-${BOB}`)!.status).toBe('failed');
    // Alice: her 10 back + Bob's 10 (the fake pool counts missed stakes only).
    expect(db.payouts).toEqual([{ wallet: ALICE, kind: 'reward', amount: '20', tx: expect.stringMatching(/^sig-/) }]);
  });

  it('voids players with unrecorded days and refunds everyone when nobody survived', async () => {
    const { chain, db, deps } = setup();
    chain.sponsors.set('R1', { address: 'R1', sponsor: 'Sponsor1111111111111111111111111111111111', amount: 7n, refunded: false });
    chain.clock = START + 3 * DAY + 900 + 600; // the verification window passed with nothing recorded
    db.work = [{ challenge_id: 'c1', address: CHALLENGE, reason: 'settle' }];
    await runVerification(deps);
    expect(chain.c.fullRefund).toBe(true);
    expect(db.payouts.map((p) => `${p.kind}:${p.amount}`).sort()).toEqual(['refund:10', 'refund:10', 'sponsor_refund:7']);
  });

  it('cancels an underfilled pool after joining closes and refunds the player and sponsors', async () => {
    const { chain, db, deps } = setup([ALICE], { joinDeadlineTs: START - 60 });
    chain.sponsors.set('R1', { address: 'R1', sponsor: 'Sponsor1111111111111111111111111111111111', amount: 7n, refunded: false });
    chain.clock = START - 30;
    db.work = [{ challenge_id: 'c1', address: CHALLENGE, reason: 'cancel' }];
    await runVerification(deps);
    expect(chain.sent).toEqual(['cancel', `refund:${ALICE}`, 'sponsor_refund:Sponsor1111111111111111111111111111111111']);
    expect(db.poolState).toBe('cancelled');
    expect(db.payoutsDone).toBeTruthy();
  });

  it('mirrors a refund paid earlier outside the job, without sending anything', async () => {
    const { chain, db, deps } = setup([ALICE]);
    chain.c.times.state = 'cancelled';
    chain.ps.get(`P-${ALICE}`)!.claimed = true;
    db.work = [{ challenge_id: 'c1', address: CHALLENGE, reason: 'payout' }];
    await runVerification(deps);
    expect(chain.sent).toEqual([]);
    expect(db.payouts).toEqual([{ wallet: ALICE, kind: 'refund', amount: '10', tx: null }]);
    expect(db.payoutsDone).toBeTruthy();
  });

  it('applies an approved dispute: failed -> verified on-chain with a dispute receipt, once', async () => {
    const { chain, db, deps } = setup([ALICE]);
    chain.c.minParticipants = 1;
    chain.ps.get(`P-${ALICE}`)!.failedDays = 1n; // day 1 recorded as failed
    chain.clock = START + 3 * DAY + 900 + 100; // in the dispute window
    db.disputes.push({ id: 'd-1', day: 0, previous_hash: 'aa'.repeat(32), review_note: 'Commit confirmed', reviewed_at: 'now', memberships: { wallet_address: ALICE, challenge_id: 'c1' } });
    await runVerification(deps);
    expect(chain.sent).toEqual([`record:${ALICE}:0:verified`]);
    expect(dayResultOf(chain.ps.get(`P-${ALICE}`)!, 0)).toBe('verified');
    const call = db.disputeCalls[0] as { fn: string; p_tx: string; p_receipt: string; p_hash: string };
    expect(call.fn).toBe('resolve_dispute');
    expect(call.p_tx).toMatch(/^sig-/);
    expect(JSON.parse(call.p_receipt)).toMatchObject({ engine: 'codestreak-dispute/1', verdict: 'verified', day: 0, dispute: 'd-1', previous_hash: 'aa'.repeat(32) });
    expect(call.p_hash).toMatch(/^[0-9a-f]{64}$/);
    await runVerification(deps);
    expect(chain.sent).toHaveLength(1); // nothing sent twice
  });

  it('expires an approved dispute once the dispute window has closed', async () => {
    const { chain, db, deps } = setup([ALICE]);
    chain.c.minParticipants = 1;
    chain.ps.get(`P-${ALICE}`)!.failedDays = 1n;
    chain.clock = START + 3 * DAY + 900 + 600; // dispute window over
    db.disputes.push({ id: 'd-2', day: 0, previous_hash: 'aa'.repeat(32), review_note: 'ok', reviewed_at: 'now', memberships: { wallet_address: ALICE, challenge_id: 'c1' } });
    await runVerification(deps);
    expect(db.disputeCalls[0]).toMatchObject({ fn: 'close_dispute', p_dispute: 'd-2', p_status: 'expired' });
    expect(chain.sent.some((s) => s.startsWith('record:'))).toBe(false);
  });

  it('does nothing without a verifier key, and says why', async () => {
    const { deps, logs } = setup();
    expect(await runVerification({ ...deps, chain: null })).toMatchObject({ skipped: 'no verifier key' });
    expect(logs[0]).toMatch(/VERIFIER_KEYPAIR_JSON is not set/);
  });

  it("refuses to record for a challenge whose verifier isn't the worker's key", async () => {
    const { chain, deps } = setup();
    chain.c.verifier = 'SomeoneE1se111111111111111111111111111111111';
    chain.clock = START + DAY + 200;
    const report = await one(deps);
    expect(chain.sent).toEqual([]);
    expect(report.errors[0]).toMatch(/cannot record days/);
  });
});

describe('participantPayout', () => {
  const base = new FakeChain([ALICE]).c;
  const p = (o: Partial<ChainParticipant>): ChainParticipant => ({
    address: 'P',
    user: ALICE,
    deposited: 10n,
    shieldPaid: 2n,
    verifiedDays: 0n,
    failedDays: 0n,
    indeterminateDays: 0n,
    shieldedDays: 0n,
    finalized: true,
    claimed: false,
    status: 'survived',
    joinedAt: 0,
    ...o,
  });
  const settled = { ...base, times: { ...base.times, state: 'settled' as const }, survivorCount: 2, rewardPerSurvivor: 4n, rewardDust: 1n };

  it('gives the dust to the last survivor to claim', () => {
    expect(participantPayout({ ...settled, survivorsClaimed: 0 }, p({}))).toEqual({ kind: 'reward', amount: 14n });
    expect(participantPayout({ ...settled, survivorsClaimed: 1 }, p({}))).toEqual({ kind: 'reward', amount: 15n });
  });
  it('refunds the stake to voided players, everything when cancelled or nobody survived, nothing to failed', () => {
    expect(participantPayout(settled, p({ status: 'voided' }))).toEqual({ kind: 'refund', amount: 10n });
    expect(participantPayout({ ...settled, times: { ...settled.times, state: 'cancelled' } }, p({ finalized: false, status: 'active' }))).toEqual({ kind: 'refund', amount: 12n });
    expect(participantPayout({ ...settled, fullRefund: true }, p({ status: 'failed' }))).toEqual({ kind: 'refund', amount: 12n });
    expect(participantPayout(settled, p({ status: 'failed' }))).toBeNull();
    expect(participantPayout(settled, p({ claimed: true }))).toBeNull();
  });
});
