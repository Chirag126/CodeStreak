// The verification job (Phase 28): for every challenge with work, under a per-challenge lease,
//   1. cancel  - joining closed with too few players -> cancel_pool
//   2. record  - each finished day, each player      -> receipt -> DB -> record_verification
//   3. settle  - dispute window over                 -> finalize_participant (each) -> settle_challenge
//   4. payout  - settled/cancelled                   -> claim_reward / claim_refund / claim_sponsor_refund
//   5. badge   - settled, each Survived player        -> mint_badge (soulbound Token-2022) -> record_badge
// and mirrors every confirmed step to the database and the audit log.
//
// Phase 43: steps of one kind (record, finalize, pay out, badge) go out several players per
// versioned transaction (Chain.pack / Chain.sendBatch). A batch lands whole or not at all; if one
// fails for any reason other than the network, its steps are sent one by one, so a single bad step
// never blocks the others and reports its own error.
//
// Idempotency: the chain is the source of truth. Every attempt to send (including each retry)
// first re-reads the account it would change and sends nothing if the change is already there, so
// a duplicate run, or a retry after a lost confirmation, never sends a second transaction. A saved
// day result is never recomputed: later runs reuse the stored receipt hash.
import { buildReceipt, canonicalJson, isTransientError, RULES_ENGINE_ID, sealReceipt, sha256Hex, withRetry, type ProviderRule, type RetryOptions } from '@codestreak/shared';
import { disputeEndTs, friendlyTxError, verifyEndTs } from '@codestreak/shared/program';
import { reconcileOne } from '../reconcile/run.js';
import { dayResultOf, type Chain, type ChainChallenge, type ChainOp, type ChainParticipant, type ChainSponsorReceipt, type DayResultName } from './chain.js';
import type { Db } from './db.js';
import type { DayEvaluation, RulesDocument } from './evaluate.js';
import { participantPayout } from './payout.js';
import { dayWindow, dueDays } from './schedule.js';

export { participantPayout };

export interface EvaluateInput {
  profileId: string;
  membershipId: string;
  day: number;
  window: { startSec: number; endSec: number };
  rules: RulesDocument;
}

export interface VerifyDeps {
  db: Db;
  /** Null when VERIFIER_KEYPAIR_JSON is not configured. */
  chain: Chain | null;
  evaluate: (input: EvaluateInput) => Promise<DayEvaluation>;
  log: (m: string) => void;
  maxChallenges?: number;
  /** Backoff for RPC reads and sends (tests pass a no-op sleep). */
  retry?: RetryOptions;
}

export interface ChallengeReport {
  challenge: string;
  reason: string;
  recorded: number;
  /** Day results reused from the database (computed by an earlier run). */
  cached: number;
  /** Player-days left for the next run (a provider couldn't be reached). */
  deferred: number;
  txs: string[];
  errors: string[];
}

interface WorkRow {
  challenge_id: string;
  address: string;
  reason: string;
}
interface ChallengeRow {
  id: string;
  rules: RulesDocument | null;
  payouts_done_at: string | null;
}
interface MemberRow {
  id: string;
  profile_id: string;
  wallet_address: string;
  participant_address: string | null;
  claimed_at: string | null;
  /** Mirrored payout (null until paid, or when only `claimed_at` was mirrored by reconcile). */
  payout?: string | number | null;
}
interface DisputeRow {
  id: string;
  day: number;
  previous_hash: string;
  review_note: string | null;
  reviewed_at: string | null;
  memberships: { wallet_address: string; challenge_id: string } | { wallet_address: string; challenge_id: string }[] | null;
}
interface DayRow {
  membership_id: string;
  day: number;
  result: DayResultName;
  evidence_hash: string;
  onchain_at: string | null;
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
/** "Title (raw error)": the program's name for the error plus the RPC's own words. */
export function errText(e: unknown): string {
  const raw = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 200);
  const f = friendlyTxError(e);
  return f.code === 'unknown' ? raw : `${f.title} (${raw})`;
}
/**
 * A deferred provider read is retried until the last call: 3 minutes before the verification
 * window closes, or its last third when the window is short (a 3-minute demo window still gets a
 * retry a minute after the first try, instead of giving up at once).
 */
export function lastCallSecs(verifyWindowSecs: number): number {
  return Math.min(180, Math.floor(verifyWindowSecs / 3));
}

export async function runVerification(deps: VerifyDeps): Promise<{ skipped?: string; challenges: ChallengeReport[] }> {
  const { db, chain, log } = deps;
  if (!chain) {
    log('skipped: VERIFIER_KEYPAIR_JSON is not set on the worker, so it cannot record days or pay out');
    return { skipped: 'no verifier key', challenges: [] };
  }
  const work = await db.rpc<WorkRow[]>('verification_work', { max_rows: deps.maxChallenges ?? 5 });
  const reports: ChallengeReport[] = [];
  for (const w of work) {
    const run = await db.rpc<string | null>('begin_verification_run', { p_challenge: w.challenge_id, p_day: 0 });
    if (!run) {
      log(`${short(w.address)}: another run is working on this challenge; skipped`);
      continue;
    }
    const report: ChallengeReport = { challenge: w.address, reason: w.reason, recorded: 0, cached: 0, deferred: 0, txs: [], errors: [] };
    let status: 'succeeded' | 'partial' | 'failed' = 'succeeded';
    let error: string | null = null;
    try {
      await new ChallengeRun(deps, chain, w, run, report).process();
      if (report.errors.length || report.deferred) status = 'partial';
      error = report.errors.join('; ') || null;
    } catch (e) {
      status = 'failed';
      error = errText(e);
    }
    await db.rpc('finish_verification_run', { p_run: run, p_status: status, p_checked: report.recorded + report.cached, p_error: error });
    log(
      `${short(w.address)} (${w.reason}): ${status}; ${report.txs.length} tx, ${report.recorded} day(s) recorded, ${report.cached} cached, ${report.deferred} deferred` +
        (error ? ` - ${error}` : ''),
    );
    reports.push(report);
  }
  return { challenges: reports };
}

type Sent = { ok: true; tx: string | null } | { ok: false };

/** Phase 43: how to send a list of same-kind steps, batched when the chain can. */
interface Many<T> {
  label: (t: T) => string;
  op: (t: T) => ChainOp;
  /** A fresh chain read: true for each step whose change is already there. */
  done: (items: T[]) => Promise<boolean[]>;
  /** The step on its own (the path without batching, and the fallback when a batch fails). */
  single: (t: T) => Promise<string>;
  /** After the steps landed (tx), or were found already done (null). */
  landed: (items: T[], tx: string | null) => Promise<void>;
}

class ChallengeRun {
  private c!: ChainChallenge;
  private row!: ChallengeRow;
  private members: MemberRow[] = [];

  constructor(
    private readonly deps: VerifyDeps,
    private readonly chain: Chain,
    private readonly w: WorkRow,
    private readonly runId: string,
    private readonly report: ChallengeReport,
  ) {}

  /** A read, retried on transient RPC failures. */
  private read<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, { ...this.deps.retry, retryable: isTransientError });
  }

  /**
   * One transaction, retried on transient failures. Every attempt first asks `done()` (a fresh
   * chain read): if the change is already there, nothing is sent and tx is null.
   */
  private async send(what: string, done: () => Promise<boolean>, fn: () => Promise<string>): Promise<Sent> {
    try {
      const tx = await withRetry(async () => ((await done()) ? null : fn()), {
        ...this.deps.retry,
        retryable: isTransientError,
        onRetry: (n, e, ms) => this.deps.log(`${what}: attempt ${n} failed (${errText(e)}); retrying in ${ms} ms`),
      });
      if (tx) this.report.txs.push(tx);
      return { ok: true, tx };
    } catch (e) {
      this.report.errors.push(`${what}: ${errText(e)}`);
      return { ok: false };
    }
  }

  /**
   * Sends same-kind steps packed into as few transactions as fit (Phase 43). Each batch is retried
   * on network failures, re-checking the chain first (steps already there are not sent again). A
   * batch that fails otherwise is sent step by step, so only the step at fault reports an error.
   */
  private async sendMany<T>(what: string, items: T[], m: Many<T>): Promise<void> {
    if (!items.length) return;
    const chain = this.chain;
    let batches: number[][] | null = null;
    if (items.length > 1 && chain.pack && chain.sendBatch) {
      try {
        batches = await this.read(() => chain.pack!(this.c, items.map(m.op)));
      } catch (e) {
        this.deps.log(`${what}: could not group the steps (${errText(e)}); sending them one by one`);
      }
    }
    if (!batches) {
      for (const t of items) await this.sendOne(m, t);
      return;
    }
    for (const group of batches) {
      const batch = group.map((i) => items[i]!);
      if (batch.length === 1) {
        await this.sendOne(m, batch[0]!);
        continue;
      }
      let already: T[] = [];
      let left: T[] = [];
      let tx: string | null;
      try {
        tx = await withRetry(
          async () => {
            const done = await m.done(batch);
            already = batch.filter((_, i) => done[i]);
            left = batch.filter((_, i) => !done[i]);
            return left.length ? chain.sendBatch!(this.c, left.map(m.op)) : null;
          },
          { ...this.deps.retry, retryable: isTransientError, onRetry: (n, e, ms) => this.deps.log(`${what} (${batch.length} steps): attempt ${n} failed (${errText(e)}); retrying in ${ms} ms`) },
        );
      } catch (e) {
        this.deps.log(`${what}: a batch of ${batch.length} failed (${errText(e)}); sending them one by one`);
        for (const t of batch) await this.sendOne(m, t);
        continue;
      }
      if (already.length) await m.landed(already, null);
      if (tx) {
        this.report.txs.push(tx);
        this.deps.log(`${what}: ${left.length} steps in one transaction (${tx.slice(0, 8)}…)`);
      }
      if (left.length) await m.landed(left, tx);
    }
  }

  private async sendOne<T>(m: Many<T>, t: T): Promise<void> {
    const sent = await this.send(m.label(t), async () => (await m.done([t]))[0] === true, () => m.single(t));
    if (sent.ok) await m.landed([t], sent.tx);
  }

  /** Fresh participant accounts: one read for one, one list read for several. */
  private async freshParticipants(addresses: string[]): Promise<Map<string, ChainParticipant>> {
    const list =
      addresses.length === 1 ? [await this.chain.participant(addresses[0]!)].filter((p): p is ChainParticipant => !!p) : await this.chain.participants(this.c.address);
    return new Map(list.map((p) => [p.address, p]));
  }

  private async refresh(): Promise<void> {
    this.c = (await this.read(() => this.chain.challenge(this.w.address))) ?? this.c;
  }

  async process(): Promise<void> {
    const { db } = this.deps;
    const address = this.w.address;
    const c = await this.read(() => this.chain.challenge(address));
    if (!c) throw new Error(`the challenge account ${address} does not exist on devnet`);
    this.c = c;
    const [row] = await db.select<ChallengeRow>('challenges', `select=id,rules,payouts_done_at&id=eq.${this.w.challenge_id}`);
    if (!row) throw new Error(`challenge ${this.w.challenge_id} is not in the database`);
    this.row = row;
    this.members = await db.select<MemberRow>('memberships', `select=id,profile_id,wallet_address,participant_address,claimed_at,payout&challenge_id=eq.${row.id}`);
    const now = await this.read(() => this.chain.now());
    const open = () => this.c.times.state === 'open';

    // 1. Cancel an underfilled pool (anyone may, once joining has closed).
    if (open() && now >= this.c.times.joinDeadlineTs && this.c.participantCount < this.c.minParticipants) {
      await this.send('cancel', async () => (await this.chain.challenge(address))?.times.state !== 'open', () => this.chain.cancel(address));
      await this.refresh();
    }

    // 1b. Approved disputes: upgrade the day on-chain before anything settles (Phase 31).
    await this.applyDisputes(now);

    // 2. Record finished days.
    if (open() && now < verifyEndTs(this.c.times)) {
      if (this.c.verifier !== this.chain.verifier) {
        this.report.errors.push(`this challenge's verifier is ${this.c.verifier}, not the worker's key ${this.chain.verifier}, so it cannot record days`);
      } else {
        await this.recordDays(now);
      }
    }

    // 3. Finalize every player, then settle.
    if (open() && now >= disputeEndTs(this.c.times)) {
      const unfinalized = (await this.read(() => this.chain.participants(address))).filter((p) => !p.finalized);
      await this.sendMany('finalize', unfinalized, {
        label: (p) => `finalize ${short(p.user)}`,
        op: (p) => ({ kind: 'finalize', participant: p.address }),
        done: async (ps) => {
          const fresh = await this.freshParticipants(ps.map((p) => p.address));
          return ps.map((p) => fresh.get(p.address)?.finalized !== false);
        },
        single: (p) => this.chain.finalize(address, p.address),
        landed: async () => {},
      });
      await this.send('settle', async () => (await this.chain.challenge(address))?.times.state !== 'open', () => this.chain.settle(address));
      await this.refresh();
    }

    // Mirror the pool state and each finished player's outcome.
    const participants = await this.read(() => this.chain.participants(address));
    await db.rpc('mirror_pool_state', {
      p_challenge: row.id,
      p_state: this.c.times.state,
      p_members: participants.filter((p) => p.status !== 'active').map((p) => ({ wallet: p.user, status: p.status })),
    });

    // 4. Payouts, pushed to each wallet.
    if (!open() && !row.payouts_done_at) {
      const errorsBefore = this.report.errors.length;
      await this.payOut(participants);
      if (this.report.errors.length === errorsBefore) await db.update('challenges', `id=eq.${row.id}`, { payouts_done_at: new Date().toISOString() });
    }

    // 5. Soulbound badges for every survivor (Phase 34). Who qualifies is decided by the program.
    if (this.c.times.state === 'settled' && participants.some((p) => p.finalized && p.status === 'survived')) {
      await this.mintBadges(participants);
      await db.update('challenges', `id=eq.${row.id}`, { badges_checked_at: new Date().toISOString() });
    }

    // Phase 29: bring the whole mirror (counts, totals, members, day flags) in line with the chain.
    try {
      await reconcileOne({ db, chain: this.chain, log: this.deps.log, retry: this.deps.retry }, address);
    } catch (e) {
      this.report.errors.push(`reconcile: ${errText(e)}`);
    }
  }

  /**
   * Approved disputes of this challenge: record_verification(day, verified) signed by the verifier,
   * with a dispute receipt (the old receipt's hash, the ticket and the review) as the evidence hash.
   * Closed as expired when the dispute window ended first; the program would refuse the upgrade.
   */
  private async applyDisputes(now: number): Promise<void> {
    const { db } = this.deps;
    const tickets = await db.select<DisputeRow>(
      'disputes',
      `select=id,day,previous_hash,review_note,reviewed_at,memberships!inner(wallet_address,challenge_id)&status=eq.approved&memberships.challenge_id=eq.${this.row.id}`,
    );
    if (!tickets.length) return;
    const address = this.c.address;
    const participants = await this.read(() => this.chain.participants(address));
    for (const t of tickets) {
      const member = Array.isArray(t.memberships) ? t.memberships[0] : t.memberships;
      const label = `dispute ${t.id.slice(0, 8)} (day ${t.day + 1})`;
      if (this.c.times.state !== 'open' || now >= disputeEndTs(this.c.times)) {
        await db.rpc('close_dispute', { p_dispute: t.id, p_status: 'expired', p_error: 'The dispute window closed before the upgrade could be recorded.' });
        this.deps.log(`${label}: expired`);
        continue;
      }
      if (this.c.verifier !== this.chain.verifier) {
        this.report.errors.push(`${label}: this challenge's verifier is not the worker's key`);
        continue;
      }
      const p = participants.find((x) => x.user === member?.wallet_address);
      if (!member || !p) {
        await db.rpc('close_dispute', { p_dispute: t.id, p_status: 'failed', p_error: 'The player has no participant account on-chain.' });
        continue;
      }
      const receipt = canonicalJson({
        challenge: address,
        member: p.user,
        day: t.day,
        engine: 'codestreak-dispute/1',
        verdict: 'verified',
        dispute: t.id,
        previous_hash: t.previous_hash,
        reviewed_at: t.reviewed_at,
        review_note: t.review_note,
      });
      const hash = await sha256Hex(receipt);
      const sent = await this.send(
        label,
        async () => dayResultOf((await this.chain.participant(p.address)) ?? p, t.day) === 'verified',
        () => this.chain.recordVerification(address, p.address, t.day, 'verified', hash),
      );
      if (!sent.ok) continue; // retried next minute; expires on its own once the window closes
      await db.rpc('resolve_dispute', { p_dispute: t.id, p_tx: sent.tx, p_receipt: receipt, p_hash: hash });
      this.deps.log(`${label}: resolved${sent.tx ? ` (${sent.tx.slice(0, 8)}…)` : ' (already verified on-chain)'}`);
    }
  }

  private async recordDays(now: number): Promise<void> {
    const { db } = this.deps;
    const c = this.c;
    const days = dueDays(c.times, now);
    if (!days.length) return;
    const participants = await this.read(() => this.chain.participants(c.address));
    const byParticipant = new Map(this.members.filter((m) => m.participant_address).map((m) => [m.participant_address as string, m]));
    const byWallet = new Map(this.members.map((m) => [m.wallet_address, m]));
    const saved = new Map<string, DayRow>();
    if (this.members.length) {
      const ids = this.members.map((m) => m.id).join(',');
      for (const r of await db.select<DayRow>('day_results', `select=membership_id,day,result,evidence_hash,onchain_at&membership_id=in.(${ids})`)) {
        saved.set(`${r.membership_id}:${r.day}`, r);
      }
    }
    const rules = this.row.rules ?? {};
    const providers = rules.providers ?? (['github', 'leetcode'] as const).filter((p) => rules[p]);
    const rule: ProviderRule = providers.length > 1 ? (rules.providerRule ?? 'any') : 'all';
    const lastCall = now >= verifyEndTs(c.times) - lastCallSecs(c.times.verifyWindowSecs);
    const markRecorded = (m: MemberRow, day: number, tx: string | null) => db.rpc('mark_day_recorded', { p_membership: m.id, p_day: day, p_tx: tx });

    const todo: { p: ChainParticipant; m: MemberRow | undefined; day: number; result: DayResultName; hash: string }[] = [];
    for (const day of days) {
      const window = dayWindow(c.times, day);
      for (const p of participants) {
        if (p.finalized) continue;
        const m = byParticipant.get(p.address) ?? byWallet.get(p.user);
        const stored = m ? saved.get(`${m.id}:${day}`) : undefined;
        if (dayResultOf(p, day)) {
          if (m && stored && !stored.onchain_at) await markRecorded(m, day, null); // an earlier run's mirror was lost
          continue;
        }

        // The day's result: the stored one, or evaluate -> seal -> save.
        let result: DayResultName;
        let hash: string;
        if (m && stored) {
          result = stored.result;
          hash = stored.evidence_hash;
          this.report.cached++;
        } else {
          let evaluation: DayEvaluation = { providers: [], evidence: [], transientFailure: null };
          if (m) {
            evaluation = await this.deps.evaluate({ profileId: m.profile_id, membershipId: m.id, day, window, rules });
            if (evaluation.transientFailure && !lastCall) {
              this.report.deferred++;
              this.deps.log(`day ${day + 1} for ${short(p.user)} deferred to the next run: ${evaluation.transientFailure}`);
              continue;
            }
          }
          // A wallet that joined on-chain without a CodeStreak account has nothing to check:
          // its day is "could not verify" (never a fail).
          const receipt = buildReceipt({ challenge: c.address, member: p.user, day, window, rulesHash: c.rulesHash, rule, providers: evaluation.providers });
          const sealed = await sealReceipt(receipt);
          if (m) {
            const [s] = await db.rpc<{ result: DayResultName; evidence_hash: string; cached: boolean }[]>('save_day_result', {
              p_membership: m.id,
              p_day: day,
              p_result: receipt.verdict,
              p_hash: sealed.evidenceHash,
              p_engine: RULES_ENGINE_ID,
              p_receipt: sealed.json,
              p_evidence: evaluation.evidence,
              p_run: this.runId,
            });
            if (!s) throw new Error('save_day_result returned nothing');
            result = s.result;
            hash = s.evidence_hash;
            if (s.cached) this.report.cached++;
          } else {
            result = receipt.verdict;
            hash = sealed.evidenceHash;
          }
        }

        todo.push({ p, m, day, result, hash });
      }
    }

    // Every result is saved; now on-chain, several player-days per transaction.
    await this.sendMany('record days', todo, {
      label: (t) => `day ${t.day + 1} for ${short(t.p.user)}`,
      op: (t) => ({ kind: 'record', participant: t.p.address, day: t.day, result: t.result, hash: t.hash }),
      done: async (ts) => {
        const fresh = await this.freshParticipants([...new Set(ts.map((t) => t.p.address))]);
        return ts.map((t) => {
          const f = fresh.get(t.p.address);
          return !f || f.finalized || dayResultOf(f, t.day) !== null;
        });
      },
      single: (t) => this.chain.recordVerification(c.address, t.p.address, t.day, t.result, t.hash),
      landed: async (ts, tx) => {
        for (const t of ts) {
          if (tx) this.report.recorded++;
          if (t.m) await markRecorded(t.m, t.day, tx);
        }
      },
    });
  }

  /**
   * Mints each survivor's badge (skipped when the mint already exists: a lost confirmation or a
   * mint someone else paid for) and mirrors it. The database refuses non-survivors and a second
   * mint address; the program refuses both on-chain anyway.
   */
  private async mintBadges(participants: ChainParticipant[]): Promise<void> {
    const { db } = this.deps;
    const ready: { p: ChainParticipant; badge: Awaited<ReturnType<Chain['badge']>> }[] = [];
    const toMint: { p: ChainParticipant; badge: Awaited<ReturnType<Chain['badge']>> }[] = [];
    for (const p of participants) {
      if (!p.finalized || p.status !== 'survived') continue;
      const badge = await this.read(() => this.chain.badge(p.address));
      (badge.minted ? ready : toMint).push({ p, badge });
    }
    await this.sendMany('badges', toMint, {
      label: (t) => `badge for ${short(t.p.user)}`,
      op: (t) => ({ kind: 'badge', participant: t.p }),
      done: (ts) => Promise.all(ts.map(async (t) => (await this.chain.badge(t.p.address)).minted)),
      single: (t) => this.chain.mintBadge(this.c, t.p),
      landed: async (ts, tx) => {
        for (const t of ts) ready.push({ p: t.p, badge: tx ? { ...t.badge, minted: true, tx } : await this.read(() => this.chain.badge(t.p.address)) });
      },
    });
    for (const { p, badge } of ready) {
      if (!badge.tx) {
        this.report.errors.push(`badge for ${short(p.user)}: minted (${badge.mint}) but its transaction was not found yet; will retry`);
        continue;
      }
      try {
        await db.rpc('record_badge', { p_challenge: this.row.id, p_wallet: p.user, p_mint: badge.mint, p_tx: badge.tx });
      } catch (e) {
        this.report.errors.push(`badge for ${short(p.user)}: ${errText(e)}`);
      }
    }
  }

  private async payOut(participants: ChainParticipant[]): Promise<void> {
    const { db } = this.deps;
    const owed: ChainParticipant[] = [];
    for (const p of participants) {
      // Paid earlier outside this job (e.g. devnet:close-challenges), or added by reconcile with only
      // `claimed_at`: the amount was never mirrored, so record it now (no receipt: no transaction).
      const member = this.members.find((m) => m.participant_address === p.address || m.wallet_address === p.user);
      if (p.claimed && member && (!member.claimed_at || member.payout === null || member.payout === undefined)) {
        const paid = participantPayout(this.c, { ...p, claimed: false });
        if (paid) await db.rpc('record_payout', { p_challenge: this.row.id, p_wallet: p.user, p_kind: paid.kind, p_amount: paid.amount.toString(), p_tx: null });
        continue;
      }
      if (participantPayout(this.c, p)) owed.push(p);
    }

    // The amounts are fixed from the challenge as read right before each send: the dust goes to the
    // last survivor to claim, so it depends on the order (the order of the steps in a batch).
    let before = this.c;
    const kindOf = (p: ChainParticipant) => participantPayout(this.c, { ...p, claimed: false })?.kind ?? 'refund';
    await this.sendMany('payouts', owed, {
      label: (p) => `${kindOf(p)} to ${short(p.user)}`,
      op: (p) => ({ kind: 'claim', participant: p, payout: kindOf(p) }),
      done: async (ps) => {
        this.c = (await this.chain.challenge(this.c.address)) ?? this.c;
        before = this.c;
        const fresh = await this.freshParticipants(ps.map((p) => p.address));
        return ps.map((p) => fresh.get(p.address)?.claimed !== false);
      },
      single: (p) => this.chain.claimParticipant(this.c, p, kindOf(p)),
      landed: async (ps, tx) => {
        let c = before;
        for (const p of ps) {
          const paid = participantPayout(c, { ...p, claimed: false });
          if (!paid) continue;
          if (paid.kind === 'reward') c = { ...c, survivorsClaimed: c.survivorsClaimed + 1 };
          await db.rpc('record_payout', { p_challenge: this.row.id, p_wallet: p.user, p_kind: paid.kind, p_amount: paid.amount.toString(), p_tx: tx });
        }
      },
    });

    await this.refresh();
    if (this.c.times.state !== 'cancelled' && !this.c.fullRefund) return; // sponsorships became rewards
    const unpaid = (await this.read(() => this.chain.sponsorReceipts(this.c.address))).filter((r) => !r.refunded);
    await this.sendMany('sponsor refunds', unpaid, {
      label: (r) => `sponsor refund to ${short(r.sponsor)}`,
      op: (r) => ({ kind: 'sponsorRefund', receipt: r }),
      done: async (rs) => {
        const fresh =
          rs.length === 1
            ? [await this.chain.sponsorReceipt(rs[0]!.address)].filter((r): r is ChainSponsorReceipt => !!r)
            : await this.chain.sponsorReceipts(this.c.address);
        const byAddress = new Map(fresh.map((r) => [r.address, r]));
        return rs.map((r) => byAddress.get(r.address)?.refunded !== false);
      },
      single: (r) => this.chain.claimSponsorRefund(this.c, r),
      landed: async (rs, tx) => {
        for (const r of rs) await db.rpc('record_payout', { p_challenge: this.row.id, p_wallet: r.sponsor, p_kind: 'sponsor_refund', p_amount: r.amount.toString(), p_tx: tx });
      },
    });
  }
}
