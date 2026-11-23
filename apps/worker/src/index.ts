import { EnvError, parseEnv, workerEnvSchema, type WorkerEnv } from '@codestreak/shared';
import { loadLocalEnv } from './load-env.js';
import { createLeetcodeSnapshotJob } from './jobs/leetcode-snapshots.js';
import { createWakeJob } from './jobs/wake.js';
import { createWorkerServer, type Job } from './server.js';

const VERSION = '0.1.0';

function loadEnv(): WorkerEnv {
  try {
    return parseEnv(workerEnvSchema, process.env, 'worker');
  } catch (e) {
    console.error(e instanceof EnvError ? e.message : e);
    process.exit(1);
  }
}

const envFile = loadLocalEnv();
const env = loadEnv();

// Jobs are added in later phases: verify (28), crank (29), voice (33).
const jobs: Record<string, Job> = {
  noop: async () => ({ message: 'worker is alive' }),
  wake: createWakeJob({ supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, version: VERSION }),
  'leetcode-snapshots': createLeetcodeSnapshotJob({ supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, firecrawlApiKey: env.FIRECRAWL_API_KEY }),
};

const server = createWorkerServer({ jobSecret: env.WORKER_JOB_SECRET, jobs, version: VERSION });
server.listen(env.PORT, '0.0.0.0', () => {
  console.log(`[worker] codestreak-worker ${VERSION} listening on :${env.PORT} (cluster ${env.SOLANA_CLUSTER})${envFile ? ` using ${envFile}` : ''}`);
  console.log(`[worker] jobs: ${Object.keys(jobs).join(', ')}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
