// Collects one user's commits for a day from the GitHub REST API (node-only, needs fetch).
//
// Since October 2025 push events no longer list their commits, only `before` and `head`, so:
//   1. GET /user/{id}                          numeric id -> current login (survives renames)
//   2. GET /users/{login}/events/public        PushEvents in the day window (max 300 events, 3 pages)
//   3. GET /repos/{repo}                       fork? owner id? (cached)
//   4. GET /repos/{repo}/compare/{before}...{head}   the pushed commits (new branch / rewritten
//                                               history: the newest commits on `head` instead)
//   5. GET /repos/{repo}/commits/{sha}         files and patches, only for commits that can count
// Anything that stops the data from being complete (rate limit, server error, too many commits)
// marks the result incomplete, which makes a below-goal day indeterminate instead of failed.
import type { GithubCommit } from './github.js';

export interface GithubResponse {
  status: number;
  json: unknown;
}

/** One authenticated GET against api.github.com (path starts with "/"). */
export type GithubGet = (path: string) => Promise<GithubResponse>;

export function createGithubGet(token: string | undefined, fetchImpl: typeof fetch = fetch): GithubGet {
  return async (path) => {
    const res = await fetchImpl(`https://api.github.com${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'CodeStreak-verifier',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    const json = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, json };
  };
}

export interface CollectResult {
  login: string | null;
  commits: GithubCommit[];
  /** False when something prevented reading everything (then a short day is indeterminate). */
  complete: boolean;
  notes: string[];
  apiCalls: number;
  /** Push events GitHub listed in the window (0 = nothing visible yet). */
  pushes: number;
}

interface PushEvent {
  type: string;
  created_at: string;
  actor?: { id?: number };
  repo?: { name?: string };
  payload?: { before?: string; head?: string; ref?: string };
}

interface ApiCommit {
  sha: string;
  parents?: { sha: string }[];
  author?: { id?: number } | null;
  commit?: { author?: { date?: string }; committer?: { date?: string } };
  files?: { filename: string; patch?: string }[];
}

const ZERO_SHA = /^0{40}$/;
const SHA = /^[0-9a-f]{40}$/;
const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export async function collectGithubCommits(input: {
  get: GithubGet;
  githubId: number;
  window: { startSec: number; endSec: number };
  /** Upper bound on per-commit detail calls for one day (keeps API usage bounded). */
  maxCommitDetails?: number;
}): Promise<CollectResult> {
  const { get, githubId, window } = input;
  const maxDetails = input.maxCommitDetails ?? 80;
  const out: CollectResult = { login: null, commits: [], complete: true, notes: [], apiCalls: 0, pushes: 0 };
  const call = async (path: string) => {
    out.apiCalls++;
    try {
      return await get(path);
    } catch {
      return { status: 0, json: null };
    }
  };
  const fail = (note: string) => {
    out.complete = false;
    out.notes.push(note);
    return out;
  };
  const transient = (status: number) => status === 0 || status === 403 || status === 429 || status >= 500;

  // 1. Current login for the numeric id.
  const user = await call(`/user/${githubId}`);
  if (user.status === 404) {
    out.notes.push('GitHub account not found (deleted?): no activity.');
    return out;
  }
  if (user.status !== 200) return fail(`user lookup failed (${user.status})`);
  const login = (user.json as { login?: string } | null)?.login;
  if (!login || !/^[A-Za-z0-9-]{1,39}$/.test(login)) return fail('user lookup returned no login');
  out.login = login;

  // 2. Push events in the window (newest first; stop once older than the window).
  const pushes: PushEvent[] = [];
  let reachedStart = false;
  for (let page = 1; page <= 3 && !reachedStart; page++) {
    const r = await call(`/users/${login}/events/public?per_page=100&page=${page}`);
    if (r.status !== 200 || !Array.isArray(r.json)) return fail(`events page ${page} failed (${r.status})`);
    const events = r.json as PushEvent[];
    for (const e of events) {
      const at = Date.parse(e.created_at) / 1000;
      if (at < window.startSec) {
        reachedStart = true;
        continue;
      }
      if (at >= window.endSec || e.type !== 'PushEvent') continue;
      if (e.actor?.id !== undefined && e.actor.id !== githubId) continue;
      pushes.push(e);
    }
    if (events.length < 100) reachedStart = true; // no more pages
  }
  if (!reachedStart) {
    out.complete = false;
    out.notes.push('more than 300 events since the day started: older pushes are out of reach');
  }

  out.pushes = pushes.length;

  // 3-5. Commits of each push, oldest push first (so a commit gets its earliest push time).
  const repos = new Map<string, { fork: boolean; ownerId: number } | null>();
  const bySha = new Map<string, GithubCommit>();
  let details = 0;
  pushes.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  for (const push of pushes) {
    const repo = push.repo?.name ?? '';
    const before = push.payload?.before ?? '';
    const head = push.payload?.head ?? '';
    if (!REPO_NAME.test(repo) || !SHA.test(head)) continue;

    if (!repos.has(repo)) {
      const r = await call(`/repos/${repo}`);
      if (r.status === 404) repos.set(repo, null); // deleted or now private: nothing to verify
      else if (r.status !== 200) return fail(`repo ${repo} lookup failed (${r.status})`);
      else {
        const j = r.json as { fork?: boolean; owner?: { id?: number } };
        repos.set(repo, { fork: j.fork === true, ownerId: j.owner?.id ?? -1 });
      }
    }
    const info = repos.get(repo);
    if (!info) continue;

    let listed: ApiCommit[] = [];
    if (SHA.test(before) && !ZERO_SHA.test(before)) {
      const r = await call(`/repos/${repo}/compare/${before}...${head}`);
      if (r.status === 200) listed = ((r.json as { commits?: ApiCommit[] }).commits ?? []).slice(-250);
      else if (transient(r.status)) return fail(`compare ${repo} failed (${r.status})`);
      // 404/422: `before` no longer exists (history rewritten); fall through to the head commits.
    }
    if (listed.length === 0) {
      const r = await call(`/repos/${repo}/commits?sha=${head}&per_page=20`);
      if (r.status === 200 && Array.isArray(r.json)) listed = (r.json as ApiCommit[]).reverse();
      else if (transient(r.status)) return fail(`commits ${repo} failed (${r.status})`);
    }

    for (const c of listed) {
      if (!SHA.test(c.sha) || bySha.has(c.sha)) continue;
      const parentShas = (c.parents ?? []).map((p) => p.sha);
      const authorId = c.author?.id ?? null;
      const base: GithubCommit = {
        sha: c.sha,
        parentShas,
        authorId,
        pushedAt: push.created_at,
        authoredAt: c.commit?.author?.date,
        committedAt: c.commit?.committer?.date,
        repo: { fullName: repo, fork: info.fork, ownerId: info.ownerId },
        files: [],
      };
      // Commits that can never count don't need their files (saves API calls).
      if (parentShas.length > 1 || authorId !== githubId) {
        bySha.set(c.sha, base);
        continue;
      }
      if (details >= maxDetails) {
        out.complete = false;
        out.notes.push(`more than ${maxDetails} commits to read: the rest were not checked`);
        bySha.set(c.sha, base);
        continue;
      }
      details++;
      const d = await call(`/repos/${repo}/commits/${c.sha}`);
      if (d.status !== 200) {
        if (transient(d.status)) return fail(`commit ${c.sha.slice(0, 8)} failed (${d.status})`);
        continue;
      }
      const files = ((d.json as ApiCommit).files ?? []).map((f) => ({ filename: f.filename, patch: f.patch }));
      bySha.set(c.sha, { ...base, files });
    }
  }

  out.commits = [...bySha.values()];
  return out;
}
