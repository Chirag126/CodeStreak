// The verification job (Phase 28): for every challenge with work, under a per-challenge lease,
//   1. cancel  - joining closed with too few players -> cancel_pool
//   2. record  - each finished day, each player      -> receipt -> DB -> record_verification
//   3. settle  - dispute window over                 -> finalize_participant (each) -> settle_challenge
//   4. payout  - settled/cancelled                   -> claim_reward / claim_refund / claim_sponsor_refund
// and mirrors every confirmed step to the database and the audit log.
//
// Idempotency: the chain is the source of truth. Every attempt to send (including each retry)
// first re-reads the account it would change and sends nothing if the change is already there, so
// a duplicate run, or a retry after a lost confirmation, never sends a second transaction. A saved
// day result is never recomputed: later runs reuse the stored receipt hash.
import { buildReceipt, isTransientError, RULES_ENGINE_ID, sealReceipt, withRetry, type ProviderRule, type RetryOptions } from '@codestreak/shared';
import { disputeEndTs, friendlyTxError, verifyEndTs } from '@codestreak/shared/program';
import { dayResultOf, type Chain, type ChainChallenge, type ChainParticipant, type DayResultName } from './chain.js';
import type { Db } from './db.js';
import type { DayEvaluation, RulesDocument } from './evaluate.js';
import { dayWindow, dueDays } from './schedule.js';

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
/** A deferred provider read is retried until 3 minutes before the verification window closes. */
const LAST_CALL_SECS = 180;

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

/** What a participant is owed now (mirrors programs/codestreak/src/rules.rs), or null. */
export function participantPayout(c: ChainChallenge, p: ChainParticipant): { kind: 'reward' | 'refund'; amount: bigint } | null {
  if (p.claimed) return null;
  const everything = p.deposited + p.shieldPaid;
  if (c.times.state === 'cancelled') return { kind: 'refund', amount: everything };
  if (c.times.state !== 'settled' || !p.finalized) return null;
  if (c.fullRefund) return { kind: 'refund', amount: everything };
  if (p.status === 'voided') return { kind: 'refund', amount: p.deposited };
  if (p.status === 'survived') {
    const last = c.survivorsClaimed + 1 === c.survivorCount;
    return { kind: 'reward', amount: p.deposited + c.rewardPerSurvivor + (last ? c.rewardDust : 0n) };
  }
  return null; // failed: their stake is part of the survivors' rewards
}

type Sent = { ok: true; tx: string | null } | { ok: false };

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
    this.members = await db.select<MemberRow>('memberships', `select=id,profile_id,wallet_address,participant_address&challenge_id=eq.${row.id}`);
    const now = await this.read(() => this.chain.now());
    const open = () => this.c.times.state === 'open';

    // 1. Cancel an underfilled pool (anyone may, once joining has closed).
    if (open() && now >= this.c.times.joinDeadlineTs && this.c.participantCount < this.c.minParticipants) {
      await this.send('cancel', async () => (await this.chain.challenge(address))?.times.state !== 'open', () => this.chain.cancel(address));
      await this.refresh();
    }

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
      for (const p of await this.read(() => this.chain.participants(address))) {
        await this.send(`finalize ${short(p.user)}`, async () => (await this.chain.participant(p.address))?.finalized !== false, () => this.chain.finalize(address, p.address));
      }
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
    const lastCall = now >= verifyEndTs(c.times) - LAST_CALL_SECS;
    const markRecorded = (m: MemberRow, day: number, tx: string | null) => db.rpc('mark_day_recorded', { p_membership: m.id, p_day: day, p_tx: tx });

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

        const sent = await this.send(
          `day ${day + 1} for ${short(p.user)}`,
          async () => {
            const fresh = await this.chain.participant(p.address);
            return !fresh || fresh.finalized || dayResultOf(fresh, day) !== null;
          },
          () => this.chain.recordVerification(c.address, p.address, day, result, hash),
        );
        if (!sent.ok) continue;
        if (sent.tx) this.report.recorded++;
        if (m) await markRecorded(m, day, sent.tx);
      }
    }
  }

  private async payOut(participants: ChainParticipant[]): Promise<void> {
    const { db } = this.deps;
    for (const p of participants) {
      if (!participantPayout(this.c, p)) continue;
      // The amount is fixed right before sending: the dust share depends on the claim order.
      await this.refresh();
      const owed = participantPayout(this.c, p);
      if (!owed) continue;
      const sent = await this.send(
        `${owed.kind} to ${short(p.user)}`,
        async () => (await this.chain.participant(p.address))?.claimed !== false,
        () => this.chain.claimParticipant(this.c, p, owed.kind),
      );
      if (sent.ok) await db.rpc('record_payout', { p_challenge: this.row.id, p_wallet: p.user, p_kind: owed.kind, p_amount: owed.amount.toString(), p_tx: sent.tx });
    }
    await this.refresh();
    if (this.c.times.state !== 'cancelled' && !this.c.fullRefund) return; // sponsorships became rewards
    for (const r of await this.read(() => this.chain.sponsorReceipts(this.c.address))) {
      if (r.refunded) continue;
      const sent = await this.send(
        `sponsor refund to ${short(r.sponsor)}`,
        async () => (await this.chain.sponsorReceipt(r.address))?.refunded !== false,
        () => this.chain.claimSponsorRefund(this.c, r),
      );
      if (sent.ok) await db.rpc('record_payout', { p_challenge: this.row.id, p_wallet: r.sponsor, p_kind: 'sponsor_refund', p_amount: r.amount.toString(), p_tx: sent.tx });
    }
  }
}
