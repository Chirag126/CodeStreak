import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// Individual repository mode: what the challenge page shows a player about their repository.

export type RepoModeName = 'individual' | 'shared' | 'any';
type GithubDoc = { repoMode?: string; repos?: { id: number; fullName: string }[] | null; allow?: { forks?: boolean } | null; ownNonForkReposOnly?: boolean } | null | undefined;

/** The challenge's repository mode (older documents: shared when they list repositories). */
export function repoModeName(github: GithubDoc): RepoModeName {
  if (github?.repoMode === 'individual' || github?.repoMode === 'shared' || github?.repoMode === 'any') return github.repoMode;
  return (github?.repos ?? []).length > 0 ? 'shared' : 'any';
}

/** Whether the challenge counts the player's own commits in their forks. */
export function forksAllowed(github: GithubDoc): boolean {
  return github?.allow?.forks === true && github?.ownNonForkReposOnly !== true;
}

export interface RepoChoiceView {
  fullName: string;
  repoId: number;
  effectiveFrom: string;
}

export interface RepoStatus {
  /** In force now (or from day 1 when the challenge hasn't started). */
  current: RepoChoiceView | null;
  /** Chosen during the challenge: applies from the next day. */
  upcoming: RepoChoiceView | null;
  /** A verified day exists: the repository can't change any more. */
  locked: boolean;
}

/** The player's repository for a challenge: current, upcoming, and whether it is locked. */
export async function loadRepoStatus(profileId: string, challengeId: string, nowMs = Date.now()): Promise<RepoStatus> {
  const admin = createSupabaseAdminClient();
  const [{ data: rows }, { data: member }] = await Promise.all([
    admin.from('challenge_repo_choices').select('repo_id, full_name, effective_from').eq('challenge_id', challengeId).eq('profile_id', profileId).order('effective_from', { ascending: true }).limit(100),
    admin.from('memberships').select('id').eq('challenge_id', challengeId).eq('profile_id', profileId).maybeSingle(),
  ]);
  const views = (rows ?? []).map((r) => ({ fullName: r.full_name as string, repoId: Number(r.repo_id), effectiveFrom: r.effective_from as string }));
  const started = views.filter((v) => Date.parse(v.effectiveFrom) <= nowMs);
  const future = views.filter((v) => Date.parse(v.effectiveFrom) > nowMs);
  // Before day 1 the only row applies from the start: show it as current.
  const current = started.at(-1) ?? (future.length && !started.length ? future.at(-1)! : null);
  const upcoming = started.length ? (future.at(-1) ?? null) : null;
  let locked = false;
  if (member) {
    const { count } = await admin.from('day_results').select('membership_id', { count: 'exact', head: true }).eq('membership_id', member.id).eq('result', 'verified');
    locked = Boolean(count);
  }
  return { current, upcoming: upcoming && upcoming.repoId !== current?.repoId ? upcoming : null, locked };
}

/** Whether the player has chosen a repository for the challenge (required to join in individual mode). */
export async function hasRepoChoice(profileId: string, challengeId: string): Promise<boolean> {
  const { count } = await createSupabaseAdminClient().from('challenge_repo_choices').select('id', { count: 'exact', head: true }).eq('challenge_id', challengeId).eq('profile_id', profileId);
  return Boolean(count);
}
