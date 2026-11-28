'use server';

import { isSolanaAddress } from '@codestreak/shared/wallet';
import { revalidatePath } from 'next/cache';
import { checkOwnRepo } from '@/lib/github/repos';
import { forksAllowed, repoModeName } from '@/lib/github/repo-choice';
import { ACTION_WRITE, takeToken } from '@/lib/http/rate-limit';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getViewer } from '@/lib/supabase/server';

export type ChooseRepoResult = { ok: true; fullName: string; effectiveFrom: string; changed: boolean } | { ok: false; error: string };

/**
 * Individual repository mode: records the viewer's repository for a challenge. Only the repository
 * id comes from the browser; GitHub is asked who owns it (it must be the viewer's linked account,
 * public, and not a fork unless forks count), and the database applies the timing and lock rules.
 */
export async function chooseRepoAction(input: { challenge: string; repoId: number }): Promise<ChooseRepoResult> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in first.' };
  if (!isSolanaAddress(input.challenge) || !Number.isSafeInteger(input.repoId) || input.repoId <= 0) return { ok: false, error: 'Invalid request.' };
  if (takeToken(`repo-choice:${viewer.userId}`, ACTION_WRITE)) return { ok: false, error: 'Too many changes. Try again in a minute.' };

  const admin = createSupabaseAdminClient();
  const { data: c } = await admin.from('challenges').select('id, rules').eq('onchain_address', input.challenge).maybeSingle();
  if (!c) return { ok: false, error: 'Challenge not found.' };
  const github = (c.rules as { github?: Parameters<typeof repoModeName>[0] } | null)?.github;
  if (!github || repoModeName(github) !== 'individual') return { ok: false, error: 'This challenge does not ask players to choose a repository.' };

  const { data: account } = await admin.from('linked_accounts').select('provider_user_id').eq('profile_id', viewer.userId).eq('provider', 'github').maybeSingle();
  if (!account) return { ok: false, error: 'Link your GitHub account first (Dashboard → Settings).' };

  const checked = await checkOwnRepo(Number(account.provider_user_id), input.repoId, forksAllowed(github));
  if (!checked.ok) return checked;

  const { data, error } = await admin.rpc('set_repo_choice', {
    p_profile: viewer.userId,
    p_challenge: c.id,
    p_repo_id: checked.repo.id,
    p_owner_id: checked.repo.ownerId,
    p_full_name: checked.repo.fullName,
  });
  // The database's own messages are written for players (locked, over, private group...).
  if (error) return { ok: false, error: error.message || 'The repository could not be saved.' };
  const out = data as { changed: boolean; effective_from: string };
  revalidatePath(`/challenges/${input.challenge}`);
  return { ok: true, fullName: checked.repo.fullName, effectiveFrom: out.effective_from, changed: out.changed };
}
