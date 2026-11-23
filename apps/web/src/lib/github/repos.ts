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
