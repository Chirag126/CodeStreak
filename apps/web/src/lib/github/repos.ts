import 'server-only';

import type { ResolvedRepo } from '@codestreak/shared';
import { createGithubGet } from '@codestreak/shared/verification';

/**
 * Looks up "owner/name" repositories on GitHub for a challenge's "only these repositories" rule:
 * each must exist and be public (pushes elsewhere can't be checked). The numeric id is stored, so
 * a later rename, transfer, or a new repository under the old name can't change which one counts.
 */
export async function resolvePublicRepos(names: string[]): Promise<{ ok: true; repos: ResolvedRepo[] } | { ok: false; error: string }> {
  const get = createGithubGet(process.env.GITHUB_API_TOKEN || undefined);
  const repos: ResolvedRepo[] = [];
  for (const name of names) {
    let r;
    try {
      r = await get(`/repos/${name}`);
    } catch {
      return { ok: false, error: 'GitHub could not be reached. Try again in a minute.' };
    }
    if (r.status === 404) {
      return { ok: false, error: `${name} was not found on GitHub. Check the spelling. Private repositories also show as not found: only public ones can be checked.` };
    }
    if (r.status === 403 || r.status === 429) return { ok: false, error: 'GitHub is limiting requests right now. Try again in a minute.' };
    if (r.status !== 200) return { ok: false, error: `GitHub answered ${r.status} for ${name}. Try again in a minute.` };
    const j = r.json as { id?: number; full_name?: string; private?: boolean };
    if (j.private) return { ok: false, error: `${name} is private. Only public repositories can be checked: make it public, or remove it.` };
    if (!j.id || !j.full_name) return { ok: false, error: `GitHub returned no details for ${name}.` };
    if (!repos.some((x) => x.id === j.id)) repos.push({ id: j.id, fullName: j.full_name });
  }
  return { ok: true, repos };
}

// ---------------------------------------------------------------- repository picker (individual + shared modes)

/** One repository as the picker shows it (public data only; no tokens ever reach the browser). */
export interface RepoSummary {
  id: number;
  ownerId: number;
  fullName: string;
  description: string | null;
  language: string | null;
  pushedAt: string | null;
  fork: boolean;
  htmlUrl: string;
}

type ApiRepo = {
  id?: number;
  full_name?: string;
  description?: string | null;
  language?: string | null;
  pushed_at?: string | null;
  fork?: boolean;
  private?: boolean;
  html_url?: string;
  owner?: { id?: number };
};

const REPO_NAME = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/;
const PAGE_SIZE = 100;
const listCache = new Map<string, { at: number; value: { repos: RepoSummary[]; hasMore: boolean } }>();

function summary(j: ApiRepo): RepoSummary | null {
  if (!j.id || !j.full_name || !REPO_NAME.test(j.full_name) || j.private || !j.owner?.id) return null;
  return {
    id: j.id,
    ownerId: j.owner.id,
    fullName: j.full_name,
    description: j.description ? j.description.slice(0, 200) : null,
    language: j.language ?? null,
    pushedAt: j.pushed_at ?? null,
    fork: j.fork === true,
    htmlUrl: `https://github.com/${j.full_name}`,
  };
}

const githubError = (status: number) =>
  status === 403 || status === 429 ? 'GitHub is limiting requests right now. Try again in a minute.' : `GitHub answered ${status}. Try again in a minute.`;

/**
 * Public repositories owned by a GitHub account (by its numeric id, so a renamed account still
 * works), most recently pushed first, 100 per page. Private ones are left out: their pushes are never
 * visible to CodeStreak, so they could never count. Cached for a minute per account and page.
 */
export async function listOwnPublicRepos(githubId: number, page: number): Promise<{ ok: true; repos: RepoSummary[]; hasMore: boolean } | { ok: false; error: string }> {
  const key = `${githubId}:${page}`;
  const hit = listCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return { ok: true, ...hit.value };
  const get = createGithubGet(process.env.GITHUB_API_TOKEN || undefined);
  try {
    const user = await get(`/user/${githubId}`);
    if (user.status === 404) return { ok: false, error: 'Your linked GitHub account no longer exists. Link it again in Settings.' };
    if (user.status !== 200) return { ok: false, error: githubError(user.status) };
    const login = (user.json as { login?: string } | null)?.login;
    if (!login || !/^[A-Za-z0-9-]{1,39}$/.test(login)) return { ok: false, error: 'GitHub returned no login for your account.' };
    const r = await get(`/users/${login}/repos?type=owner&sort=pushed&direction=desc&per_page=${PAGE_SIZE}&page=${page}`);
    if (r.status !== 200 || !Array.isArray(r.json)) return { ok: false, error: githubError(r.status) };
    const raw = r.json as ApiRepo[];
    const value = { repos: raw.map(summary).filter((x): x is RepoSummary => x !== null), hasMore: raw.length === PAGE_SIZE };
    if (listCache.size > 500) listCache.clear();
    listCache.set(key, { at: Date.now(), value });
    return { ok: true, ...value };
  } catch {
    return { ok: false, error: 'GitHub could not be reached. Try again in a minute.' };
  }
}

/**
 * Checks a repository a player wants for an individual-mode challenge, by id (never by a name the
 * browser sends): it must exist, be public, belong to the player's linked GitHub account, and not
 * be a fork unless the challenge counts forks. Returns GitHub's own id, owner and current name.
 */
export async function checkOwnRepo(githubId: number, repoId: number, allowForks: boolean): Promise<{ ok: true; repo: RepoSummary } | { ok: false; error: string }> {
  if (!Number.isSafeInteger(repoId) || repoId <= 0) return { ok: false, error: 'Invalid repository.' };
  let r;
  try {
    r = await createGithubGet(process.env.GITHUB_API_TOKEN || undefined)(`/repositories/${repoId}`);
  } catch {
    return { ok: false, error: 'GitHub could not be reached. Try again in a minute.' };
  }
  if (r.status === 404) return { ok: false, error: "That repository doesn't exist or isn't public. Only public repositories can be checked." };
  if (r.status !== 200) return { ok: false, error: githubError(r.status) };
  const j = r.json as ApiRepo;
  if (j.private) return { ok: false, error: 'That repository is private. Only public repositories can be checked: make it public, or pick another.' };
  const repo = summary(j);
  if (!repo) return { ok: false, error: 'GitHub returned no details for that repository.' };
  if (repo.ownerId !== githubId) return { ok: false, error: `${repo.fullName} isn't owned by your linked GitHub account. Pick one of your own repositories.` };
  if (repo.fork && !allowForks) return { ok: false, error: `${repo.fullName} is a fork, and this challenge doesn't count forks. Pick a repository you created.` };
  return { ok: true, repo };
}
