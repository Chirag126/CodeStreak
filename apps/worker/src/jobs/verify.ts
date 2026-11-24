import { createSolanaChain, loadVerifier, type Chain } from '../verify/chain.js';
import { createRestDb } from '../verify/db.js';
import { evaluateMemberDay, type EvaluateDeps } from '../verify/evaluate.js';
import { runVerification } from '../verify/run.js';
import type { Job } from '../server.js';

export interface VerifyJobOptions {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  rpcUrl: string;
  verifierKeypairJson?: string;
  verifierPubkey?: string;
  githubToken?: string;
  firecrawlApiKey?: string;
}

/**
 * Scheduled verification (pg_cron wakes it every minute, only when public.verification_has_work()):
 * records finished days on-chain, cancels underfilled pools, settles, and pays out.
 */
export function createVerifyJob(options: VerifyJobOptions): Job {
  let chain: Chain | null | undefined;
  return async ({ log }) => {
    if (!options.supabaseUrl || !options.serviceRoleKey) {
      log('skipped: Supabase service role not configured');
      return { skipped: true };
    }
    // Built once per process; a bad key fails every run with the same clear message.
    if (chain === undefined) {
      const verifier = loadVerifier(options.verifierKeypairJson, options.verifierPubkey);
      chain = verifier ? createSolanaChain(options.rpcUrl, verifier) : null;
      if (chain) log(`verifier ${chain.verifier}`);
    }
    const db = createRestDb(options.supabaseUrl, options.serviceRoleKey);
    const evalDeps: EvaluateDeps = { db, githubToken: options.githubToken, firecrawlApiKey: options.firecrawlApiKey, githubCache: new Map(), log };
    const result = await runVerification({ db, chain, log, evaluate: (input) => evaluateMemberDay(evalDeps, input) });
    return { ...result };
  };
}
