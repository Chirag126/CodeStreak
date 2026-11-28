import { describe, expect, it } from 'vitest';
import { choiceForDay, DEFAULT_GITHUB_RULES, evaluateGithubDay, githubDayOutcome, githubRulesFromDocument, repoModeOf, type RepoChoice } from './github.js';
import { collectGithubCommits, type GithubGet, type GithubResponse } from './github-fetch.js';

const ID = 187127921;
const LOGIN = 'Chirag126';
const WINDOW = { startSec: Date.parse('2026-11-23T00:00:00Z') / 1000, endSec: Date.parse('2026-11-24T00:00:00Z') / 1000 };
const sha = (c: string) => c.repeat(40).slice(0, 40);
const code = (n: number, t: string) => Array.from({ length: n }, (_, i) => `+export const ${t}${i} = compute(${i});`).join('\n');
const ok = (json: unknown): GithubResponse => ({ status: 200, json });
const fresh = () => ({ shas: new Set<string>(), diffHashes: new Set<string>() });

/** A fake GitHub: routes -> responses, recording every path asked for. */
function fakeGithub(routes: Record<string, GithubResponse>) {
  const calls: string[] = [];
  const get: GithubGet = async (path) => {
    calls.push(path);
    return routes[path] ?? { status: 404, json: { message: 'Not Found' } };
  };
  return { get, calls };
}

// Shapes as returned by the real API (seen on Chirag126/trust-dependency-mapper, 23 Nov 2026).
const repo = (id: number, full: string, pushedAt: string, extra: object = {}) => ({ id, full_name: full, fork: false, private: false, pushed_at: pushedAt, owner: { id: ID }, ...extra });
const activity = (at: string, before: string, after: string, type = 'push', actorId = ID) => ({ timestamp: at, activity_type: type, ref: 'refs/heads/main', before, after, actor: { id: actorId, login: LOGIN } });
const listed = (s: string, parents: string[], authorId: number | null, date = '2026-11-23T09:00:00Z') => ({
  sha: s,
  parents: parents.map((p) => ({ sha: p })),
  author: authorId === null ? null : { id: authorId },
  commit: { author: { date }, committer: { date } },
});
const base = {
  [`/user/${ID}`]: ok({ login: LOGIN, id: ID }),
};
const reposPath = `/users/${LOGIN}/repos?type=owner&sort=pushed&direction=desc&per_page=100`;
const activityPath = (full: string) => `/repos/${full}/activity?per_page=100&direction=desc&actor=${LOGIN}`;

describe('collecting a day of GitHub commits (repository activity)', () => {
  it('finds pushes the public feed has not listed yet, and gives a real day result', async () => {
    const gh = fakeGithub({
      ...base,
      [reposPath]: ok([repo(1, 'Chirag126/app', '2026-11-23T12:37:03Z'), repo(2, 'Chirag126/old', '2026-10-01T00:00:00Z')]),
      [activityPath('Chirag126/app')]: ok([
        activity('2026-11-23T12:37:03Z', sha('a'), sha('c')),
        activity('2026-11-23T11:00:00Z', sha('9'), sha('a'), 'pr_merge'), // merge button: not read
        activity('2026-11-22T20:00:00Z', sha('8'), sha('9')), // the day before
      ]),
      [`/repos/Chirag126/app/compare/${sha('a')}...${sha('c')}`]: ok({
        commits: [listed(sha('b'), [sha('a')], ID), listed(sha('c'), [sha('b'), sha('x')], ID), listed(sha('d'), [sha('c')], 81847)],
      }),
      [`/repos/Chirag126/app/commits/${sha('b')}`]: ok({ files: [{ filename: 'src/app.ts', patch: code(20, 'b') }] }),
    });
    const r = await collectGithubCommits({ get: gh.get, githubId: ID, window: WINDOW });
    expect(r).toMatchObject({ complete: true, login: LOGIN, pushes: 1 });
    expect(r.repos).toEqual([{ fullName: 'Chirag126/app', status: 'read', pushes: 1 }]);
    // The repo not pushed today is never read; details only for the commit that can count.
    expect(gh.calls.some((p) => p.includes('Chirag126/old'))).toBe(false);
    expect(gh.calls.filter((p) => p.includes('/commits/'))).toEqual([`/repos/Chirag126/app/commits/${sha('b')}`]);

    const day = evaluateGithubDay({ commits: r.commits, userGithubId: ID, window: WINDOW, seen: fresh() });
    expect(day.meaningfulLines).toBe(20);
    expect(day.skipped.map((s) => s.reason).sort()).toEqual(['author-mismatch', 'merge-commit']);
    expect(githubDayOutcome(day, r)).toBe('verified');
  });

  it('a commit carrying your email but pushed by someone else never counts (spoofed author)', async () => {
    const gh = fakeGithub({
      ...base,
      [reposPath]: ok([repo(1, 'Chirag126/app', '2026-11-23T12:00:00Z')]),
      [activityPath('Chirag126/app')]: ok([activity('2026-11-23T12:00:00Z', sha('a'), sha('b'), 'push', 999)]),
      [`/repos/Chirag126/app/compare/${sha('a')}...${sha('b')}`]: ok({ commits: [listed(sha('b'), [sha('a')], ID)] }),
    });
    const r = await collectGithubCommits({ get: gh.get, githubId: ID, window: WINDOW });
    const day = evaluateGithubDay({ commits: r.commits, userGithubId: ID, window: WINDOW, seen: fresh() });
    expect(day.skipped[0]?.reason).toBe('pushed-by-other');
    expect(gh.calls.filter((p) => p.includes('/commits/'))).toHaveLength(0);
  });

  it('creator-selected repositories: read by id (any owner), and only those count', async () => {
    const team = { id: 77, full_name: 'acme/team-app', fork: false, private: false, owner: { id: 5 } };
    const gh = fakeGithub({
      ...base,
      '/repositories/77': ok(team),
      [activityPath('acme/team-app')]: ok([activity('2026-11-23T10:00:00Z', sha('a'), sha('b'))]),
      [`/repos/acme/team-app/compare/${sha('a')}...${sha('b')}`]: ok({ commits: [listed(sha('b'), [sha('a')], ID)] }),
      [`/repos/acme/team-app/commits/${sha('b')}`]: ok({ files: [{ filename: 'src/x.ts', patch: code(16, 't') }] }),
    });
    const r = await collectGithubCommits({ get: gh.get, githubId: ID, window: WINDOW, repoIds: [77] });
    expect(gh.calls).not.toContain(reposPath); // own repos aren't listed in this mode
    const rules = { ...DEFAULT_GITHUB_RULES, repos: [77] };
    const day = evaluateGithubDay({ commits: r.commits, userGithubId: ID, window: WINDOW, rules, seen: fresh() });
    expect(day.meetsThreshold).toBe(true); // not the user's repo, but selected by the creator
    // Same commit, but the challenge selected another repo: doesn't count.
    const other = evaluateGithubDay({ commits: r.commits, userGithubId: ID, window: WINDOW, rules: { ...DEFAULT_GITHUB_RULES, repos: [88] }, seen: fresh() });
    expect(other.skipped[0]?.reason).toBe('other-repo');
  });

  it('a selected repository made private or deleted makes the day indeterminate, not failed', async () => {
    const gone = await collectGithubCommits({ get: fakeGithub(base).get, githubId: ID, window: WINDOW, repoIds: [77] });
    expect(gone.complete).toBe(false);
    expect(gone.notes[0]).toMatch(/no longer public or no longer exists/);
    const priv = await collectGithubCommits({ get: fakeGithub({ ...base, '/repositories/77': ok({ id: 77, full_name: 'acme/x', private: true }) }).get, githubId: ID, window: WINDOW, repoIds: [77] });
    expect(priv.notes[0]).toMatch(/private now/);
    const day = evaluateGithubDay({ commits: [], userGithubId: ID, window: WINDOW, seen: fresh() });
    expect(githubDayOutcome(day, priv)).toBe('indeterminate');
  });

  describe('individual mode: each player\'s own repository', () => {
    const mine = { id: 501, full_name: 'Chirag126/streak', fork: false, private: false, owner: { id: ID } };
    const doc = { minMeaningfulLines: 15, repoMode: 'individual' as const };
    const choice: RepoChoice = { repoId: 501, ownerId: ID, fullName: 'Chirag126/streak', effectiveFrom: '2026-11-23T00:00:00Z' };
    const routes = (repoJson: object) => ({
      ...base,
      '/repositories/501': ok(repoJson),
      [activityPath((repoJson as { full_name: string }).full_name)]: ok([activity('2026-11-23T10:00:00Z', sha('a'), sha('b'))]),
      [`/repos/${(repoJson as { full_name: string }).full_name}/compare/${sha('a')}...${sha('b')}`]: ok({ commits: [listed(sha('b'), [sha('a')], ID)] }),
      [`/repos/${(repoJson as { full_name: string }).full_name}/commits/${sha('b')}`]: ok({ files: [{ filename: 'src/x.ts', patch: code(16, 'i') }] }),
    });

    it('counts pushes to the chosen repository only, read by id', async () => {
      const gh = fakeGithub(routes(mine));
      const rules = githubRulesFromDocument(doc, choice);
      expect(rules).toMatchObject({ repos: [501], repoScope: 'member' });
      const r = await collectGithubCommits({ get: gh.get, githubId: ID, window: WINDOW, repoIds: rules.repos, memberRepo: true });
      expect(gh.calls).not.toContain(reposPath);
      const day = evaluateGithubDay({ commits: r.commits, userGithubId: ID, window: WINDOW, rules, seen: fresh() });
      expect(githubDayOutcome(day, r)).toBe('verified');
      // The same push, but another repository was chosen: it doesn't count.
      const other = evaluateGithubDay({ commits: r.commits, userGithubId: ID, window: WINDOW, rules: githubRulesFromDocument(doc, { ...choice, repoId: 502 }), seen: fresh() });
      expect(other.skipped[0]?.reason).toBe('other-repo');
    });

    it('a chosen repository transferred to someone else, or a fork, no longer counts', async () => {
      const rules = githubRulesFromDocument(doc, choice);
      const moved = await collectGithubCommits({ get: fakeGithub(routes({ ...mine, owner: { id: 42 } })).get, githubId: ID, window: WINDOW, repoIds: [501], memberRepo: true });
      expect(evaluateGithubDay({ commits: moved.commits, userGithubId: ID, window: WINDOW, rules, seen: fresh() }).skipped[0]?.reason).toBe('not-repo-owner');
      const fork = await collectGithubCommits({ get: fakeGithub(routes({ ...mine, fork: true })).get, githubId: ID, window: WINDOW, repoIds: [501], memberRepo: true });
      expect(evaluateGithubDay({ commits: fork.commits, userGithubId: ID, window: WINDOW, rules, seen: fresh() }).skipped[0]?.reason).toBe('fork');
    });

    it('deleting or hiding your own repository fails the day (it is no escape from a missed day)', async () => {
      const rules = githubRulesFromDocument(doc, choice);
      const empty = evaluateGithubDay({ commits: [], userGithubId: ID, window: WINDOW, rules, seen: fresh() });
      const gone = await collectGithubCommits({ get: fakeGithub(base).get, githubId: ID, window: WINDOW, repoIds: [501], memberRepo: true });
      expect(gone).toMatchObject({ complete: true, repos: [{ status: 'missing' }] });
      expect(githubDayOutcome(empty, gone)).toBe('failed');
      const hidden = await collectGithubCommits({ get: fakeGithub({ ...base, '/repositories/501': ok({ ...mine, private: true }) }).get, githubId: ID, window: WINDOW, repoIds: [501], memberRepo: true });
      expect(githubDayOutcome(empty, hidden)).toBe('failed');
      // A GitHub outage is still never the player's fault.
      const down = await collectGithubCommits({ get: fakeGithub({ ...base, '/repositories/501': { status: 503, json: null } }).get, githubId: ID, window: WINDOW, repoIds: [501], memberRepo: true });
      expect(githubDayOutcome(empty, down)).toBe('indeterminate');
    });

    it('no repository chosen: nothing counts, and nothing is read', async () => {
      const gh = fakeGithub(routes(mine));
      const rules = githubRulesFromDocument(doc, null);
      expect(rules).toMatchObject({ repos: [], repoScope: 'member' });
      const r = await collectGithubCommits({ get: gh.get, githubId: ID, window: WINDOW, repoIds: rules.repos, memberRepo: true });
      expect(r).toMatchObject({ complete: true, pushes: 0 });
      expect(r.notes[0]).toMatch(/No repository was chosen/);
      expect(githubDayOutcome(evaluateGithubDay({ commits: [], userGithubId: ID, window: WINDOW, rules, seen: fresh() }), r)).toBe('failed');
    });
  });

  it('repository modes: older documents keep their meaning; a day uses the choice in force when it started', () => {
    expect(repoModeOf({ repos: [{ id: 1, fullName: 'a/b' }] })).toBe('shared');
    expect(repoModeOf({})).toBe('any');
    expect(repoModeOf({ repoMode: 'individual', repos: [{ id: 1, fullName: 'a/b' }] })).toBe('individual');
    expect(githubRulesFromDocument({ minMeaningfulLines: 15, repos: [{ id: 7, fullName: 'a/b' }] })).toMatchObject({ repos: [7], repoScope: 'shared' });
    expect(githubRulesFromDocument({ minMeaningfulLines: 15 }).repos).toEqual([]);
    const day2 = Date.parse('2026-11-24T00:00:00Z') / 1000;
    const a: RepoChoice = { repoId: 1, ownerId: ID, fullName: 'a/one', effectiveFrom: '2026-11-23T00:00:00Z' };
    const b: RepoChoice = { repoId: 2, ownerId: ID, fullName: 'a/two', effectiveFrom: '2026-11-24T00:00:00Z' };
    expect(choiceForDay([a, b], WINDOW.startSec)?.repoId).toBe(1); // a change made on day 1 doesn't reach day 1
    expect(choiceForDay([b, a], day2)?.repoId).toBe(2);
    expect(choiceForDay([b], WINDOW.startSec)).toBeNull();
  });

  it('a new branch (zero before) and rewritten history use the newest commits on the branch', async () => {
    const gh = fakeGithub({
      ...base,
      [reposPath]: ok([repo(1, 'Chirag126/app', '2026-11-23T12:00:00Z')]),
      [activityPath('Chirag126/app')]: ok([
        activity('2026-11-23T10:00:00Z', '0'.repeat(40), sha('e'), 'branch_creation'),
        activity('2026-11-23T11:00:00Z', sha('9'), sha('f'), 'force_push'),
      ]),
      [`/repos/Chirag126/app/commits?sha=${sha('e')}&per_page=20`]: ok([listed(sha('e'), [sha('1')], ID)]),
      [`/repos/Chirag126/app/commits?sha=${sha('f')}&per_page=20`]: ok([listed(sha('f'), [sha('e')], ID), listed(sha('e'), [sha('1')], ID)]),
      [`/repos/Chirag126/app/commits/${sha('e')}`]: ok({ files: [] }),
      [`/repos/Chirag126/app/commits/${sha('f')}`]: ok({ files: [] }),
    });
    const r = await collectGithubCommits({ get: gh.get, githubId: ID, window: WINDOW });
    expect(r.complete).toBe(true);
    expect(r.commits.map((c) => c.sha[0]).sort()).toEqual(['e', 'f']); // e keeps its first push
    expect(r.commits.find((c) => c.sha === sha('e'))?.pushedAt).toBe('2026-11-23T10:00:00Z');
  });

  it('rate limits, server and network errors make the data incomplete (a short day becomes indeterminate)', async () => {
    const limited = await collectGithubCommits({ get: fakeGithub({ ...base, [reposPath]: { status: 403, json: {} } }).get, githubId: ID, window: WINDOW });
    expect(limited.complete).toBe(false);
    const day = evaluateGithubDay({ commits: [], userGithubId: ID, window: WINDOW, seen: fresh() });
    expect(githubDayOutcome(day, limited)).toBe('indeterminate');
    const network = await collectGithubCommits({ get: async () => { throw new Error('ECONNRESET'); }, githubId: ID, window: WINDOW });
    expect(network.complete).toBe(false);
  });

  it('too many commits: the rest are not read and the result is marked incomplete', async () => {
    const many = Array.from({ length: 5 }, (_, i) => listed(String(i + 1).repeat(40), [sha('a')], ID));
    const routes: Record<string, GithubResponse> = {
      ...base,
      [reposPath]: ok([repo(1, 'Chirag126/app', '2026-11-23T12:00:00Z')]),
      [activityPath('Chirag126/app')]: ok([activity('2026-11-23T10:00:00Z', sha('a'), '5'.repeat(40))]),
      [`/repos/Chirag126/app/compare/${sha('a')}...${'5'.repeat(40)}`]: ok({ commits: many }),
    };
    for (const c of many) routes[`/repos/Chirag126/app/commits/${c.sha}`] = ok({ files: [] });
    const gh = fakeGithub(routes);
    const r = await collectGithubCommits({ get: gh.get, githubId: ID, window: WINDOW, maxCommitDetails: 2 });
    expect(r.complete).toBe(false);
    expect(gh.calls.filter((p) => p.includes('/commits/'))).toHaveLength(2);
  });

  it('no repository pushed that day: complete, zero pushes', async () => {
    const r = await collectGithubCommits({ get: fakeGithub({ ...base, [reposPath]: ok([repo(1, 'Chirag126/app', '2026-10-01T00:00:00Z')]) }).get, githubId: ID, window: WINDOW });
    expect(r).toMatchObject({ complete: true, pushes: 0, repos: [] });
  });

  it('a deleted GitHub account means no activity (not an error)', async () => {
    const r = await collectGithubCommits({ get: fakeGithub({}).get, githubId: ID, window: WINDOW });
    expect(r).toMatchObject({ complete: true, commits: [], pushes: 0 });
  });
});
