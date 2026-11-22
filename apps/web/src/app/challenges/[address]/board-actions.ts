'use server';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getViewer } from '@/lib/supabase/server';

type Result = { ok: true } | { ok: false; error: string };

/** Owner: who can see the member board (anyone who can see the challenge, or players only). */
export async function setBoardVisibilityAction(challengeId: string, visibility: 'viewers' | 'participants'): Promise<Result> {
  if (visibility !== 'viewers' && visibility !== 'participants') return { ok: false, error: 'Unknown setting.' };
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from('challenges').update({ board_visibility: visibility }).eq('id', String(challengeId)).eq('creator_id', viewer.userId).select('id');
  if (error || !data?.length) return { ok: false, error: 'Only the creator can change this.' };
  await admin.from('audit_log').insert({ actor_kind: 'user', actor_id: viewer.userId, action: 'board.visibility', entity_type: 'challenge', entity_id: String(challengeId), details: { visibility } });
  return { ok: true };
}

/** Member: whether their check details (counts and providers) are shown to the others. */
export async function setShareChecksAction(membershipId: string, share: boolean): Promise<Result> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  const { data, error } = await createSupabaseAdminClient()
    .from('memberships')
    .update({ share_checks: Boolean(share) })
    .eq('id', String(membershipId))
    .eq('profile_id', viewer.userId)
    .select('id');
  if (error || !data?.length) return { ok: false, error: 'Could not change your setting.' };
  return { ok: true };
}
