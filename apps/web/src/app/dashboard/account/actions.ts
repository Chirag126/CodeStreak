'use server';

import { revalidatePath } from 'next/cache';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

/** The user's own appeal; the database checks there is something to appeal and one at a time. */
export async function submitAppealAction(message: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in first.' };
  if (typeof message !== 'string' || message.trim().length < 10 || message.length > 2000) return { ok: false, error: 'Write 10 to 2000 characters.' };
  const { error } = await (await createSupabaseServerClient()).rpc('submit_appeal', { p_message: message });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/dashboard/account');
  return { ok: true };
}
