// Phase 29 - chain -> database reconciliation. The chain is the source of truth: for every
// challenge of the program, the worker reads the account, its participants and their day results,
// and public.reconcile_challenge() fixes whatever the database got wrong (logged in audit_log).
// Read-only on the chain: reconciliation never sends a transaction.
import { isTransientError, withRetry, type RetryOptions } from '@codestreak/shared';
import { dayResultOf, type Chain, type ChainChallenge, type ChainParticipant } from '../verify/chain.js';
import type { Db } from '../verify/db.js';
import { participantPayout } from '../verify/payout.js';

export interface ReconcileResult {
  challenge_id: string;
  added: boolean;
  changes: string[];
  warnings: string[];
}

export interface ReconcileReport {
  checked: number;
  added: number;
  fixed: number;
  warnings: string[];
}

export interface ReconcileDeps {
  db: Db;
  chain: Chain;
  log: (m: string) => void;
  retry?: RetryOptions;
}

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/** The arguments of public.reconcile_challenge for one challenge as the chain has it. */
export function reconcileArgs(c: ChainChallenge, participants: ChainParticipant[], sponsorRefundPending: boolean) {
  return {
    p_chain: { ...c.mirror, creator: c.creator },
    p_participants: participants.map((p) => {
      const days: Record<string, string> = {};
      for (let d = 0; d < c.times.numDays; d++) {
        const r = dayResultOf(p, d);
        if (r) days[String(d)] = r;
      }
      return {
        address: p.address,
        wallet: p.user,
        deposited: p.deposited.toString(),
        status: p.status,
        finalized: p.finalized,
        claimed: p.claimed,
        joined_at: p.joinedAt,
        days,
      };
    }),
    // Something is still owed (the payout job must not consider this challenge done).
    p_payouts_pending: c.times.state !== 'open' && (sponsorRefundPending || participants.some((p) => participantPayout(c, p) !== null)),
  };
}

/** Reconciles one challenge (also called by the verification job after it changes a challenge). */
export async function reconcileOne(deps: ReconcileDeps, address: string, known?: ChainChallenge): Promise<ReconcileResult | null> {
  const read = <T>(fn: () => Promise<T>) => withRetry(fn, { ...deps.retry, retryable: isTransientError });
  const c = known ?? (await read(() => deps.chain.challenge(address)));
  if (!c) return null;
  const participants = await read(() => deps.chain.participants(address));
  const refundsSponsors = c.times.state === 'cancelled' || (c.times.state === 'settled' && c.fullRefund);
  const sponsorRefundPending = refundsSponsors && (await read(() => deps.chain.sponsorReceipts(address))).some((r) => !r.refunded);
  const result = await deps.db.rpc<ReconcileResult>('reconcile_challenge', reconcileArgs(c, participants, sponsorRefundPending));
  for (const ch of result.changes) deps.log(`${short(address)}: fixed ${ch}`);
  for (const w of result.warnings) deps.log(`${short(address)}: warning: ${w}`);
  return result;
}

/** Reconciles every challenge on-chain, and reports database challenges missing from the chain. */
export async function runReconcile(deps: ReconcileDeps): Promise<ReconcileReport> {
  const report: ReconcileReport = { checked: 0, added: 0, fixed: 0, warnings: [] };
  const read = <T>(fn: () => Promise<T>) => withRetry(fn, { ...deps.retry, retryable: isTransientError });
  const known = await deps.db.select<{ onchain_address: string }>('challenges', 'select=onchain_address&onchain_address=not.is.null&limit=2000');

  let onChain: ChainChallenge[];
  try {
    onChain = await read(() => deps.chain.allChallenges());
  } catch (e) {
    // Listing decodes every account; one unreadable account must not stop the rest.
    deps.log(`listing every challenge failed (${e instanceof Error ? e.message : String(e)}); checking the database's challenges one by one`);
    onChain = [];
    for (const k of known) {
      try {
        const c = await read(() => deps.chain.challenge(k.onchain_address));
        if (c) onChain.push(c);
      } catch (err) {
        report.warnings.push(`${short(k.onchain_address)}: could not be read (${err instanceof Error ? err.message : String(err)})`);
      }
    }
  }

  const seen = new Set<string>();
  for (const c of onChain) {
    seen.add(c.address);
    try {
      const r = await reconcileOne(deps, c.address, c);
      if (!r) continue;
      report.checked++;
      if (r.added) report.added++;
      if (r.changes.length) report.fixed++;
      report.warnings.push(...r.warnings.map((w) => `${short(c.address)}: ${w}`));
    } catch (e) {
      report.warnings.push(`${short(c.address)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const k of known) {
    if (!seen.has(k.onchain_address) && !report.warnings.some((w) => w.startsWith(short(k.onchain_address)))) {
      report.warnings.push(`${short(k.onchain_address)}: in the database but not on devnet`);
    }
  }
  deps.log(`reconciled ${report.checked} challenge(s): ${report.added} added, ${report.fixed} fixed, ${report.warnings.length} warning(s)`);
  return report;
}
