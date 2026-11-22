'use server';

import { revalidatePath } from 'next/cache';
import { unlinkGithub } from '@/lib/accounts/github';
import { getViewer } from '@/lib/supabase/server';

/** Step 1 of unlinking: CodeStreak's record (refused while in an open challenge). */
export async function unlinkGithubAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  const r = await unlinkGithub(viewer.userId);
  revalidatePath('/dashboard/settings');
  return r;
}
