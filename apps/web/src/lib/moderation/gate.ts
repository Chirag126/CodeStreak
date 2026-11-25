import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export type ModeratedFeature = 'challenges' | 'groups' | 'sponsorship';

const FEATURE_TEXT: Record<ModeratedFeature, string> = {
  challenges: 'joining or creating challenges',
  groups: 'creating groups or inviting people',
  sponsorship: 'sponsoring challenges',
};

/**
 * Moderation gate for every relayed transaction (Phase 37.1). Returns a ready error, or null when the
 * account may use the feature. The database decides (account_gate): suspended, banned, deleting, an
 * explicit restriction, or a pending re-verification all block. Fails closed if the check can't run.
 */
export async function moderationBlock(profileId: string, feature: ModeratedFeature): Promise<{ ok: false; error: string; code: string; title: string } | null> {
  const { data, error } = await createSupabaseAdminClient().rpc('account_gate', { p_profile: profileId, p_feature: feature });
  if (error || !data) {
    return { ok: false, code: 'account.check_failed', title: 'Could not check your account', error: 'Please try again in a moment.' };
  }
  const gate = data as { allowed: boolean; status: string; reason: string | null };
  if (gate.allowed) return null;
  const why =
    gate.status === 'suspended' ? 'Your account is suspended.' : gate.status === 'banned' ? 'Your account is banned.' : gate.status === 'pending_deletion' || gate.status === 'deleted' ? 'Your account is being deleted.' : `Your account is restricted from ${FEATURE_TEXT[feature]}.`;
  return {
    ok: false,
    code: 'account.restricted',
    title: 'Not available for your account',
    error: `${why}${gate.reason ? ` Reason: ${gate.reason}` : ''} See Dashboard → Account for details or to appeal.`,
  };
}
