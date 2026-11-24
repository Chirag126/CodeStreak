import { runReconcile } from '../reconcile/run.js';
import { createSolanaChain } from '../verify/chain.js';
import { createRestDb } from '../verify/db.js';
import type { Job } from '../server.js';

export interface ReconcileJobOptions {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  rpcUrl: string;
}

/** pg_cron (:05 and :35): mirror every on-chain challenge into the database and fix drift. Read-only on the chain. */
export function createReconcileJob(options: ReconcileJobOptions): Job {
  return async ({ log }) => {
    if (!options.supabaseUrl || !options.serviceRoleKey) {
      log('skipped: Supabase service role not configured');
      return { skipped: true };
    }
    const chain = createSolanaChain(options.rpcUrl, null); // reads only: no key needed
    const db = createRestDb(options.supabaseUrl, options.serviceRoleKey);
    return { ...(await runReconcile({ db, chain, log })) };
  };
}
