'use server';

import { usernameErrorFromDb, usernameSchema } from '@codestreak/shared';
import { redirect } from 'next/navigation';
import { safeNext, SIGN_IN_PATH } from '@/lib/auth/routes';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type UsernameState = { error?: string; value?: string };

/**
 * Claims a username for the signed-in user. Runs as the user (RLS: only their own row, only the
 * presentation columns). Uniqueness is decided by the database, so two people racing for the same
 * name can't both get it: the loser receives "That username is taken."
 */
export async function claimUsername(_prev: UsernameState, form: FormData): Promise<UsernameState> {
  const raw = String(form.get('username') ?? '');
  const parsed = usernameSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, value: raw };

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect(SIGN_IN_PATH);

  const { data: updated, error } = await supabase
    .from('profiles')
    .update({ username: parsed.data })
    .eq('id', userId)
    .select('username')
    .maybeSingle();
  const message = usernameErrorFromDb(error);
  if (message) return { error: message, value: parsed.data };
  if (!updated) return { error: 'Could not save your username. Please try again.', value: parsed.data };

  redirect(safeNext(String(form.get('next') ?? '')));
}

/** Live availability hint while typing (the save above is still the source of truth). */
export async function isUsernameAvailable(raw: string): Promise<{ ok: boolean; message: string }> {
  const parsed = usernameSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? 'Invalid username.' };
  const supabase = await createSupabaseServerClient();
  const { count, error } = await supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('username', parsed.data);
  if (error) return { ok: false, message: 'Could not check right now.' };
  return count ? { ok: false, message: 'That username is taken.' } : { ok: true, message: `${parsed.data} is available.` };
}
