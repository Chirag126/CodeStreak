import { describe, expect, it } from 'vitest';
import { evaluateGithubDay, githubDayOutcome } from './github.js';
import { collectGithubCommits, type GithubGet, type GithubResponse } from './github-fetch.js';

const ID = 187127921;
const WINDOW = { startSec: Date.parse('2026-11-22T00:00:00Z') / 1000, endSec: Date.parse('2026-11-23T00:00:00Z') / 1000 };
const sha = (c: string) => c.repeat(40).slice(0, 40);
const code = (n: number, t: string) => Array.from({ length: n }, (_, i) => `+export const ${t}${i} = compute(${i});`).join('\n');

/** A fake GitHub: routes -> responses, recording every path asked for. */
function fakeGithub(routes: Record<string, GithubResponse | (() => GithubResponse)>) {
  const calls: string[] = [];
  const get: GithubGet = async (path) => {
    calls.push(path);
    const r = routes[path];
    if (!r) return { status: 404, json: { message: 'Not Found' } };
    return typeof r === 'function' ? r() : r;
  };
  return { get, calls };
}

const ok = (json: unknown): GithubResponse => ({ status: 200, json });
// Shapes as returned by the real API (payload has no commit list since Oct 2025).
const push = (at: string, repo: string, before: string, head: string) => ({
  type: 'PushEvent',
  created_at: at,
  actor: { id: ID, login: 'Chirag126' },
  repo: { name: repo },
  payload: { before, head, ref: 'refs/heads/main', push_id: 1 },
});
const listed = (s: string, parents: string[], authorId: number | null, date = '2026-11-22T09:00:00Z') => ({
  sha: s,
  parents: parents.map((p) => ({ sha: p })),
  author: authorId === null ? null : { id: authorId },
  commit: { author: { date }, committer: { date } },
});

describe('collecting a day of GitHub commits', () => {
  it('push event -> compare -> commit details, then a real day result', async () => {
    const gh = fakeGithub({
      [`/user/${ID}`]: ok({ login: 'Chirag126', id: ID }),
      '/users/Chirag126/events/public?per_page=100&page=1': ok([
        push('2026-11-22T10:00:00Z', 'Chirag126/app', sha('a'), sha('c')),
        { type: 'WatchEvent', created_at: '2026-11-22T09:00:00Z', actor: { id: ID }, repo: { name: 'x/y' }, payload: {} },
        push('2026-11-21T22:00:00Z', 'Chirag126/app', sha('0'), sha('9')), // before the day
      ]),
      '/repos/Chirag126/app': ok({ fork: false, owner: { id: ID } }),
      [`/repos/Chirag126/app/compare/${sha('a')}...${sha('c')}`]: ok({
        commits: [listed(sha('b'), [sha('a')], ID), listed(sha('c'), [sha('b'), sha('x')], ID), listed(sha('d'), [sha('c')], 81847)],
      }),
      [`/repos/Chirag126/app/commits/${sha('b')}`]: ok({ files: [{ filename: 'src/app.ts', patch: code(20, 'b') }] }),
    });
    const r = await collectGithubCommits({ get: gh.get, githubId: ID, window: WINDOW });
    expect(r.complete).toBe(true);
    expect(r.login).toBe('Chirag126');
    expect(r.commits.map((c) => c.sha[0])).toEqual(['b', 'c', 'd']);
    // Details were fetched only for the commit that can count (not the merge, not the other author).
    expect(gh.calls.filter((p) => p.includes('/commits/'))).toEqual([`/repos/Chirag126/app/commits/${sha('b')}`]);

    const day = evaluateGithubDay({ commits: r.commits, userGithubId: ID, window: WINDOW, seen: { shas: new Set(), diffHashes: new Set() } });
    expect(day.meaningfulLines).toBe(20);
    expect(day.skipped.map((s) => s.reason).sort()).toEqual(['author-mismatch', 'merge-commit']);
    expect(githubDayOutcome(day, r)).toBe('verified');
  });

  it('a new branch (zero before) uses the newest commits on head', async () => {
    const gh = fakeGithub({
      [`/user/${ID}`]: ok({ login: 'Chirag126' }),
      '/users/Chirag126/events/public?per_page=100&page=1': ok([push('2026-11-22T10:00:00Z', 'Chirag126/app', '0'.repeat(40), sha('e'))]),
      '/repos/Chirag126/app': ok({ fork: false, owner: { id: ID } }),
      [`/repos/Chirag126/app/commits?sha=${sha('e')}&per_page=20`]: ok([listed(sha('e'), [sha('f')], ID)]),
      [`/repos/Chirag126/app/commits/${sha('e')}`]: ok({ files: [{ filename: 'main.py', patch: code(5, 'e') }] }),
    });
    const r = await collectGithubCommits({ get: gh.get, githubId: ID, window: WINDOW });
    expect(r.commits).toHaveLength(1);
    expect(r.commits[0]!.files[0]!.filename).toBe('main.py');
  });

  it('rewritten history (compare 404) falls back to the head commits', async () => {
    const gh = fakeGithub({
      [`/user/${ID}`]: ok({ login: 'Chirag126' }),
      '/users/Chirag126/events/public?per_page=100&page=1': ok([push('2026-11-22T10:00:00Z', 'Chirag126/app', sha('a'), sha('e'))]),
      '/repos/Chirag126/app': ok({ fork: false, owner: { id: ID } }),
      [`/repos/Chirag126/app/commits?sha=${sha('e')}&per_page=20`]: ok([listed(sha('e'), [sha('f')], ID)]),
      [`/repos/Chirag126/app/commits/${sha('e')}`]: ok({ files: [] }),
    });
    const r = await collectGithubCommits({ get: gh.get, githubId: ID, window: WINDOW });
    expect(r.complete).toBe(true);
    expect(r.commits).toHaveLength(1);
  });

  it('rate limits and server errors make the data incomplete (a short day becomes indeterminate)', async () => {
    const gh = fakeGithub({
      [`/user/${ID}`]: ok({ login: 'Chirag126' }),
      '/users/Chirag126/events/public?per_page=100&page=1': { status: 403, json: { message: 'API rate limit exceeded' } },
    });
    const r = await collectGithubCommits({ get: gh.get, githubId: ID, window: WINDOW });
    expect(r.complete).toBe(false);
    const day = evaluateGithubDay({ commits: r.commits, userGithubId: ID, window: WINDOW, seen: { shas: new Set(), diffHashes: new Set() } });
    expect(githubDayOutcome(day, r)).toBe('indeterminate');
  });

  it('a network error is treated like a server error', async () => {
    const r = await collectGithubCommits({ get: async () => { throw new Error('ECONNRESET'); }, githubId: ID, window: WINDOW });
    expect(r.complete).toBe(false);
  });

  it('too many commits: the rest are not read and the result is marked incomplete', async () => {
    const many = Array.from({ length: 5 }, (_, i) => listed(String(i + 1).repeat(40), [sha('a')], ID));
    const routes: Record<string, GithubResponse> = {
      [`/user/${ID}`]: ok({ login: 'Chirag126' }),
      '/users/Chirag126/events/public?per_page=100&page=1': ok([push('2026-11-22T10:00:00Z', 'Chirag126/app', sha('a'), '5'.repeat(40))]),
      '/repos/Chirag126/app': ok({ fork: false, owner: { id: ID } }),
      [`/repos/Chirag126/app/compare/${sha('a')}...${'5'.repeat(40)}`]: ok({ commits: many }),
    };
    for (const c of many) routes[`/repos/Chirag126/app/commits/${c.sha}`] = ok({ files: [] });
    const gh = fakeGithub(routes);
    const r = await collectGithubCommits({ get: gh.get, githubId: ID, window: WINDOW, maxCommitDetails: 2 });
    expect(r.complete).toBe(false);
    expect(gh.calls.filter((p) => p.includes('/commits/'))).toHaveLength(2);
  });

  it('a deleted GitHub account means no activity (not an error)', async () => {
    const r = await collectGithubCommits({ get: fakeGithub({}).get, githubId: ID, window: WINDOW });
    expect(r).toMatchObject({ complete: true, commits: [] });
  });
});
