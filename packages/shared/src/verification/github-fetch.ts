// Collects one user's commits for a day from the GitHub REST API (node-only, needs fetch).
//
// GitHub's public event feed lags (minutes to hours) and, since October 2025, lists no commits.
// The repository activity API records every push immediately, with GitHub's server time, the
// branch, before/after and WHO pushed, so it is the source of truth here:
//   1. GET /user/{id}                                numeric id -> current login (survives renames)
//   2. Repositories to read:
//        - creator-selected repos: GET /repositories/{id} (by id: survives renames and transfers)
//        - otherwise: GET /users/{login}/repos?type=owner&sort=pushed   (public repos the user owns,
//          pushed since the day started)
//   3. GET /repos/{repo}/activity?actor={login}      the user's pushes, branch creations, force pushes
//   4. GET /repos/{repo}/compare/{before}...{after}  the pushed commits (new branch / rewritten
//                                                    history: the newest commits on `after` instead)
//   5. GET /repos/{repo}/commits/{sha}               files and patches, only for commits that can count
// Merge-button merges ("pr_merge") are not read: that work counts when it is pushed.
// Anything that stops the data being complete marks the result incomplete, which makes a
// below-goal day indeterminate (never failed).
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

export interface RepoReport {
  fullName: string;
  /** read: pushes found; no-pushes: none by this user in the day; missing/private: can't be read. */
  status: 'read' | 'no-pushes' | 'missing' | 'private';
  pushes: number;
}

export interface CollectResult {
  login: string | null;
  commits: GithubCommit[];
  /** False when something prevented reading everything (then a short day is indeterminate). */
  complete: boolean;
  notes: string[];
  apiCalls: number;
  /** The user's pushes found in the day window, across all repositories read. */
  pushes: number;
  repos: RepoReport[];
}

interface Activity {
  timestamp: string;
  activity_type: string;
  before?: string;
  after?: string;
  actor?: { id?: number } | null;
}

interface ApiCommit {
  sha: string;
  parents?: { sha: string }[];
  author?: { id?: number } | null;
  commit?: { author?: { date?: string }; committer?: { date?: string } };
  files?: { filename: string; patch?: string }[];
}

interface ApiRepo {
  id?: number;
  full_name?: string;
  fork?: boolean;
  private?: boolean;
  pushed_at?: string;
  owner?: { id?: number };
}

const ZERO_SHA = /^0{40}$/;
const SHA = /^[0-9a-f]{40}$/;
const REPO_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COUNTED_ACTIVITY = new Set(['push', 'force_push', 'branch_creation']);
/** Owned repositories pushed in one day that we read (more = incomplete). */
const MAX_REPOS = 20;

export async function collectGithubCommits(input: {
  get: GithubGet;
  githubId: number;
  window: { startSec: number; endSec: number };
  /** Creator-selected repositories (numeric ids); empty/absent = the user's own public repos. */
  repoIds?: number[] | null;
  /**
   * The ids are the player's own choice (individual mode). Then nothing chosen means nothing can
   * count, and a chosen repository that is gone or private is the player's doing: the day can fail
   * (instead of "couldn't be checked", which would let anyone escape a missed day by hiding it).
   */
  memberRepo?: boolean;
  /** Upper bound on per-commit detail calls for one day (keeps API usage bounded). */
  maxCommitDetails?: number;
}): Promise<CollectResult> {
  const { get, githubId, window } = input;
  const maxDetails = input.maxCommitDetails ?? 80;
  const out: CollectResult = { login: null, commits: [], complete: true, notes: [], apiCalls: 0, pushes: 0, repos: [] };
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
  const inWindow = (iso: string | undefined) => {
    const t = iso ? Date.parse(iso) / 1000 : Number.NaN;
    return t >= window.startSec && t < window.endSec;
  };

  // 1. Current login for the numeric id.
  const user = await call(`/user/${githubId}`);
  if (user.status === 404) {
    out.notes.push('This GitHub account no longer exists, so it has no activity.');
    return out;
  }
  if (user.status !== 200) return fail(`Could not look up the GitHub account (HTTP ${user.status}).`);
  const login = (user.json as { login?: string } | null)?.login;
  if (!login || !/^[A-Za-z0-9-]{1,39}$/.test(login)) return fail('GitHub returned no login for this account.');
  out.login = login;

  // 2. Repositories to read.
  const targets: { id: number; fullName: string; fork: boolean; ownerId: number }[] = [];
  const selected = (input.repoIds ?? []).filter((id) => Number.isSafeInteger(id) && id > 0);
  if (input.memberRepo && selected.length === 0) {
    out.notes.push('No repository was chosen for this challenge, so no push could count.');
    return out;
  }
  if (selected.length > 0) {
    for (const id of selected) {
      const r = await call(`/repositories/${id}`);
      if (input.memberRepo && (r.status === 404 || (r.status === 200 && (r.json as ApiRepo | null)?.private))) {
        out.repos.push({ fullName: (r.json as ApiRepo | null)?.full_name ?? `repository #${id}`, status: r.status === 404 ? 'missing' : 'private', pushes: 0 });
        out.notes.push('Your challenge repository was deleted or made private, so no push could count.');
        return out;
      }
      if (r.status === 404) {
        // Deleted or made private: nobody can be checked there, so nobody is failed for it.
        out.repos.push({ fullName: `repository #${id}`, status: 'missing', pushes: 0 });
        return fail(`The selected repository #${id} is no longer public or no longer exists, so pushes there can't be checked.`);
      }
      if (r.status !== 200) return fail(`Could not read the selected repository #${id} (HTTP ${r.status}).`);
      const j = r.json as ApiRepo;
      if (j.private) {
        out.repos.push({ fullName: j.full_name ?? `#${id}`, status: 'private', pushes: 0 });
        return fail(`The selected repository ${j.full_name} is private now, so pushes there can't be checked.`);
      }
      if (j.full_name && REPO_NAME.test(j.full_name)) targets.push({ id, fullName: j.full_name, fork: j.fork === true, ownerId: j.owner?.id ?? -1 });
    }
  } else {
    const r = await call(`/users/${login}/repos?type=owner&sort=pushed&direction=desc&per_page=100`);
    if (r.status !== 200 || !Array.isArray(r.json)) return fail(`Could not list the account's repositories (HTTP ${r.status}).`);
    for (const j of r.json as ApiRepo[]) {
      // pushed_at is the latest push: anything pushed during the day has pushed_at >= the day start.
      if (!j.pushed_at || Date.parse(j.pushed_at) / 1000 < window.startSec) continue;
      if (j.private || !j.id || !j.full_name || !REPO_NAME.test(j.full_name)) continue;
      targets.push({ id: j.id, fullName: j.full_name, fork: j.fork === true, ownerId: j.owner?.id ?? -1 });
    }
    if (targets.length > MAX_REPOS) {
      targets.length = MAX_REPOS;
      out.complete = false;
      out.notes.push(`More than ${MAX_REPOS} repositories were pushed since the day started; only the ${MAX_REPOS} most recent were read.`);
    }
  }

  // 3. The user's pushes in each repository.
  type Push = { repo: (typeof targets)[number]; at: string; before: string; after: string; pusherId: number | null };
  const pushes: Push[] = [];
  for (const repo of targets) {
    const r = await call(`/repos/${repo.fullName}/activity?per_page=100&direction=desc&actor=${encodeURIComponent(login)}`);
    if (r.status !== 200 || !Array.isArray(r.json)) {
      if (transient(r.status)) return fail(`Could not read the activity of ${repo.fullName} (HTTP ${r.status}).`);
      out.repos.push({ fullName: repo.fullName, status: 'missing', pushes: 0 });
      continue;
    }
    const all = r.json as Activity[];
    const found = all.filter((a) => COUNTED_ACTIVITY.has(a.activity_type) && inWindow(a.timestamp));
    if (all.length === 100 && all.every((a) => Date.parse(a.timestamp) / 1000 >= window.startSec)) {
      out.complete = false;
      out.notes.push(`${repo.fullName} has more than 100 pushes since the day started; older ones were not read.`);
    }
    for (const a of found) {
      if (!a.after || !SHA.test(a.after)) continue;
      pushes.push({ repo, at: a.timestamp, before: a.before ?? '', after: a.after, pusherId: a.actor?.id ?? null });
    }
    out.repos.push({ fullName: repo.fullName, status: found.length ? 'read' : 'no-pushes', pushes: found.length });
  }
  out.pushes = pushes.length;
  pushes.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  // 4-5. Commits of each push (a commit keeps its earliest push).
  const bySha = new Map<string, GithubCommit>();
  let details = 0;
  for (const push of pushes) {
    const name = push.repo.fullName;
    let listed: ApiCommit[] = [];
    if (SHA.test(push.before) && !ZERO_SHA.test(push.before)) {
      const r = await call(`/repos/${name}/compare/${push.before}...${push.after}`);
      if (r.status === 200) listed = ((r.json as { commits?: ApiCommit[] }).commits ?? []).slice(-250);
      else if (transient(r.status)) return fail(`Could not compare a push in ${name} (HTTP ${r.status}).`);
      // 404/422: `before` no longer exists (history rewritten): use the newest commits instead.
    }
    if (listed.length === 0) {
      const r = await call(`/repos/${name}/commits?sha=${push.after}&per_page=20`);
      if (r.status === 200 && Array.isArray(r.json)) listed = (r.json as ApiCommit[]).reverse();
      else if (transient(r.status)) return fail(`Could not list the commits of a push in ${name} (HTTP ${r.status}).`);
    }

    for (const c of listed) {
      if (!SHA.test(c.sha) || bySha.has(c.sha)) continue;
      const parentShas = (c.parents ?? []).map((p) => p.sha);
      const authorId = c.author?.id ?? null;
      const base: GithubCommit = {
        sha: c.sha,
        parentShas,
        authorId,
        pusherId: push.pusherId,
        pushedAt: push.at,
        authoredAt: c.commit?.author?.date,
        committedAt: c.commit?.committer?.date,
        repo: { id: push.repo.id, fullName: name, fork: push.repo.fork, ownerId: push.repo.ownerId },
        files: [],
      };
      // Commits that can never count don't need their files (saves API calls).
      if (parentShas.length > 1 || authorId !== githubId || push.pusherId !== githubId) {
        bySha.set(c.sha, base);
        continue;
      }
      if (details >= maxDetails) {
        out.complete = false;
        out.notes.push(`More than ${maxDetails} commits to read in one day; the rest were not checked.`);
        bySha.set(c.sha, base);
        continue;
      }
      details++;
      const d = await call(`/repos/${name}/commits/${c.sha}`);
      if (d.status !== 200) {
        if (transient(d.status)) return fail(`Could not read commit ${c.sha.slice(0, 8)} in ${name} (HTTP ${d.status}).`);
        continue;
      }
      const files = ((d.json as ApiCommit).files ?? []).map((f) => ({ filename: f.filename, patch: f.patch }));
      bySha.set(c.sha, { ...base, files });
    }
  }

  out.commits = [...bySha.values()];
  return out;
}
