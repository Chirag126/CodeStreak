import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { createWorkerServer, secretMatches } from './server.js';

const SECRET = 'a'.repeat(64);
let server: http.Server;
let base = '';
let release: () => void = () => {};

beforeAll(async () => {
  server = createWorkerServer({
    jobSecret: SECRET,
    version: 'test',
    log: () => {},
    jobs: {
      noop: async () => ({ message: 'alive' }),
      boom: async () => {
        throw new Error('kaput');
      },
      slow: () => new Promise((resolve) => (release = () => resolve({ done: true }))),
    },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const post = (path: string, secret?: string) =>
  fetch(`${base}${path}`, { method: 'POST', headers: secret ? { Authorization: `Bearer ${secret}` } : {} });

describe('worker server', () => {
  it('secret comparison', () => {
    expect(secretMatches(SECRET, SECRET)).toBe(true);
    expect(secretMatches('wrong', SECRET)).toBe(false);
    expect(secretMatches(undefined, SECRET)).toBe(false);
    expect(secretMatches('', '')).toBe(false);
  });

  it('health is public', async () => {
    const r = await fetch(`${base}/health`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { service: string }).service).toBe('codestreak-worker');
  });

  it('jobs require the secret', async () => {
    expect((await post('/jobs/noop')).status).toBe(401);
    expect((await post('/jobs/noop', 'nope')).status).toBe(401);
  });

  it('runs a job', async () => {
    const r = await post('/jobs/noop', SECRET);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, job: 'noop', result: { message: 'alive' } });
  });

  it('unknown job, wrong method, failing job', async () => {
    expect((await post('/jobs/missing', SECRET)).status).toBe(404);
    expect((await fetch(`${base}/jobs/noop`)).status).toBe(405);
    const r = await post('/jobs/boom', SECRET);
    expect(r.status).toBe(500);
    expect(await r.json()).toMatchObject({ ok: false, error: 'kaput' });
  });

  it('does not run the same job twice at once', async () => {
    const first = post('/jobs/slow', SECRET);
    await new Promise((r) => setTimeout(r, 50));
    expect((await post('/jobs/slow', SECRET)).status).toBe(409);
    release();
    expect((await first).status).toBe(200);
  });
});
