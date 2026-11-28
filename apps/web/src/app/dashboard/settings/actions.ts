'use server';

import { revalidatePath } from 'next/cache';
import { unlinkGithub } from '@/lib/accounts/github';
import { cancelLeetcodeBinding, startLeetcodeBinding, unlinkLeetcode, verifyLeetcodeBinding } from '@/lib/accounts/leetcode';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

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

// ---------------------------------------------------------------- Phase 41.2: alerts and voice

const PREF_KEYS = ['deadlines', 'results', 'rewards', 'group_updates', 'voice', 'browser'] as const;
type PrefKey = (typeof PREF_KEYS)[number];

/** Saves one or more notification switches (the database refuses anything else). */
export async function saveNotificationPrefsAction(patch: Partial<Record<PrefKey, boolean>>): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  const clean: Partial<Record<PrefKey, boolean>> = {};
  for (const k of PREF_KEYS) if (typeof patch?.[k] === 'boolean') clean[k] = patch[k];
  if (Object.keys(clean).length === 0) return { ok: false, error: 'Nothing to save.' };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc('set_notification_prefs', { p_prefs: clean });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/dashboard/settings');
  return { ok: true };
}

/** Deadline alerts show end times in this zone. Only real IANA zones are accepted. */
export async function saveTimezoneAction(timezone: string): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  const tz = String(timezone ?? '').trim();
  let valid = tz.length > 0 && tz.length <= 64;
  try {
    if (valid) valid = Boolean(new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, error: 'That is not a time zone this server knows.' };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from('profiles').update({ timezone: tz }).eq('id', viewer.userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/dashboard/settings');
  return { ok: true };
}
