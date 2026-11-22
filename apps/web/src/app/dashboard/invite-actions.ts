'use server';

import { revalidatePath } from 'next/cache';
import { respondToInvite } from '@/lib/groups/invites';
import { getViewer } from '@/lib/supabase/server';

export async function respondAction(inviteId: string, answer: 'accept' | 'decline'): Promise<{ ok: boolean; error?: string }> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  if (answer !== 'accept' && answer !== 'decline') return { ok: false, error: 'Unknown answer.' };
  const r = await respondToInvite(viewer.userId, String(inviteId), answer);
  revalidatePath('/dashboard');
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}
