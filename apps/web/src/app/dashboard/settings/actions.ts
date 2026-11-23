'use server';

import { revalidatePath } from 'next/cache';
import { unlinkGithub } from '@/lib/accounts/github';
import { cancelLeetcodeBinding, startLeetcodeBinding, unlinkLeetcode, verifyLeetcodeBinding } from '@/lib/accounts/leetcode';
import { getViewer } from '@/lib/supabase/server';

/** Step 1 of unlinking: CodeStreak's record (refused while in an open challenge). */
export async function unlinkGithubAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  const r = await unlinkGithub(viewer.userId);
  revalidatePath('/dashboard/settings');
  return r;
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function asViewer<T>(fn: (id: string) => Promise<Result<T>>): Promise<Result<T>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  const r = await fn(viewer.userId);
  revalidatePath('/dashboard/settings');
  return r;
}

export async function startLeetcodeAction(handle: string) {
  return asViewer((id) => startLeetcodeBinding(id, String(handle)));
}

export async function verifyLeetcodeAction() {
  return asViewer((id) => verifyLeetcodeBinding(id));
}

export async function cancelLeetcodeAction() {
  return asViewer(async (id) => {
    await cancelLeetcodeBinding(id);
    return { ok: true as const };
  });
}

export async function unlinkLeetcodeAction() {
  return asViewer((id) => unlinkLeetcode(id));
}
