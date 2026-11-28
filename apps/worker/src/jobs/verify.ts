import { createSolanaChain, loadVerifier, type Chain, type LookupTableStore } from '../verify/chain.js';
import { createRestDb, type Db } from '../verify/db.js';
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
    const db = createRestDb(options.supabaseUrl, options.serviceRoleKey);
    // Built once per process; a bad key fails every run with the same clear message.
    if (chain === undefined) {
      const verifier = loadVerifier(options.verifierKeypairJson, options.verifierPubkey);
      chain = verifier ? createSolanaChain(options.rpcUrl, verifier, { tables: lookupTableStore(db), log: (m) => console.log(`[worker] ${m}`) }) : null;
      if (chain) log(`verifier ${chain.verifier}`);
    }
    const evalDeps: EvaluateDeps = { db, githubToken: options.githubToken, firecrawlApiKey: options.firecrawlApiKey, githubCache: new Map(), log };
    const result = await runVerification({ db, chain, log, evaluate: (input) => evaluateMemberDay(evalDeps, input) });
    return { ...result };
  };
}

/** Phase 43: the worker's address lookup table is remembered in public.chain_lookup_tables (service role only). */
export function lookupTableStore(db: Db): LookupTableStore {
  return {
    load: async (authority) => (await db.select<{ address: string }>('chain_lookup_tables', `select=address&authority=eq.${authority}`))[0]?.address ?? null,
    save: (authority, address, addresses) =>
      db.insert('chain_lookup_tables', [{ authority, address, addresses, updated_at: new Date().toISOString() }], { onConflict: 'authority' }),
  };
}
