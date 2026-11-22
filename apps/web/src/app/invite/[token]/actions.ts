'use server';

import { redirect } from 'next/navigation';
import { redeemInviteLink } from '@/lib/groups/invites';
import { getViewer } from '@/lib/supabase/server';

/** Redeeming is a POST from a button, never a page load, so link previews can't use up invites. */
export async function redeemAction(token: string): Promise<{ error: string }> {
  const viewer = await getViewer();
  if (!viewer) return { error: 'Sign in first.' };
  const r = await redeemInviteLink(viewer.userId, String(token));
  if (!r.ok) return { error: r.error };
  redirect(`/challenges/${r.address}`);
}
