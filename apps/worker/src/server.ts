// Minimal HTTP surface of the worker (no framework).
//   GET  /health        -> liveness (Render health check + warm-up pings)
//   POST /jobs/:name    -> runs a registered job; requires "Authorization: Bearer <WORKER_JOB_SECRET>"
// Supabase pg_cron + pg_net call the job endpoints on a schedule (Render free plan has no cron).
import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';

export type JobResult = Record<string, unknown>;
export type Job = (ctx: { log: (message: string) => void }) => Promise<JobResult>;

export interface WorkerServerOptions {
  jobSecret: string;
  jobs: Record<string, Job>;
  version: string;
  log?: (message: string) => void;
}

/** Constant-time secret comparison (hashing first makes lengths equal). */
export function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

const JOB_PATH = /^\/jobs\/([a-z0-9-]{1,64})$/;

export function createWorkerServer(options: WorkerServerOptions): http.Server {
  const log = options.log ?? ((m: string) => console.log(`[worker] ${m}`));
  const running = new Set<string>();
  const startedAt = Date.now();

  return http.createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const path = (req.url ?? '/').split('?')[0] ?? '/';

    if (path === '/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { error: 'method not allowed' });
      return send(200, { ok: true, service: 'codestreak-worker', version: options.version, uptimeSec: Math.round((Date.now() - startedAt) / 1000) });
    }

    const match = JOB_PATH.exec(path);
    if (!match) return send(404, { error: 'not found' });
    if (req.method !== 'POST') return send(405, { error: 'method not allowed' });

    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!secretMatches(token, options.jobSecret)) {
      log(`rejected unauthorized call to ${path}`);
      return send(401, { error: 'unauthorized' });
    }

    const name = match[1] ?? '';
    const job = options.jobs[name];
    if (!job) return send(404, { error: `unknown job "${name}"` });

    // pg_cron may fire again while a slow run is still going; never run the same job twice at once.
    if (running.has(name)) return send(409, { error: `job "${name}" is already running` });
    running.add(name);
    const t0 = Date.now();
    try {
      const result = await job({ log: (m) => log(`${name}: ${m}`) });
      const durationMs = Date.now() - t0;
      log(`${name}: ok in ${durationMs} ms`);
      return send(200, { ok: true, job: name, durationMs, result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      log(`${name}: FAILED ${message}`);
      return send(500, { ok: false, job: name, error: message });
    } finally {
      running.delete(name);
    }
  });
}
