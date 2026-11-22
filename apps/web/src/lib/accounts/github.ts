import 'server-only';

import { githubAccountFromIdentity, type GithubAccount } from '@codestreak/shared';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export interface GithubStatus {
  account: (GithubAccount & { linkedAt: string }) | null;
  /** In an open challenge: can't unlink or switch accounts. */
  locked: boolean;
  /** Something the user should know (e.g. a link that was refused). */
  notice: string | null;
}

/** True while the profile is in a challenge that isn't settled or cancelled (mirrors the DB rule). */
export async function inOpenChallenge(profileId: string): Promise<boolean> {
  const { data } = await createSupabaseAdminClient()
    .from('memberships')
    .select('id, challenges!inner(pool_state)')
    .eq('profile_id', profileId)
    .eq('status', 'active')
    .eq('challenges.pool_state', 'open')
    .limit(1);
  return Boolean(data?.length);
}

const COOLDOWN = 'This GitHub account was linked to another CodeStreak user in the last 30 days, so it can’t be linked yet.';
const TAKEN = 'This GitHub account is already linked to another CodeStreak account.';
const LOCKED = 'Your GitHub account is locked while you are in an open challenge. It stays as it was.';

function friendly(error: { code?: string; message?: string; hint?: string } | null): string {
  if (!error) return 'Could not save your GitHub account. Try again.';
  if (error.code === '23505') return TAKEN;
  if (error.hint === 'cooldown' || /30 days/.test(error.message ?? '')) return COOLDOWN;
  if (error.hint === 'locked' || /locked/.test(error.message ?? '')) return LOCKED;
  return 'Could not save your GitHub account. Try again.';
}

/**
 * Brings CodeStreak's record in line with the user's Supabase identities. The identity is read
 * from the Supabase admin API (never from the browser). CodeStreak's record is authoritative:
 *  - a new GitHub identity is recorded (unless the database refuses: taken / cooldown);
 *  - a renamed GitHub username is refreshed (the numeric ID is what counts);
 *  - a different GitHub identity, or a removed one, only replaces the record when not locked.
 */
export async function syncGithub(profileId: string): Promise<GithubStatus> {
  const admin = createSupabaseAdminClient();
  const [{ data: userData, error: userError }, { data: row, error: rowError }, locked] = await Promise.all([
    admin.auth.admin.getUserById(profileId),
    admin.from('linked_accounts').select('provider_user_id, provider_username, linked_at').eq('profile_id', profileId).eq('provider', 'github').maybeSingle(),
    inOpenChallenge(profileId),
  ]);
  if (userError || rowError || !userData?.user) {
    // Never treat a failed lookup as "unlinked": change nothing.
    const kept = row ? { id: row.provider_user_id as string, username: row.provider_username as string, linkedAt: row.linked_at as string } : null;
    return { account: kept, locked, notice: 'Could not check your GitHub link right now. Try again shortly.' };
  }
  const identities = userData.user.identities ?? [];
  const identity = githubAccountFromIdentity(identities.find((i) => i.provider === 'github') as Parameters<typeof githubAccountFromIdentity>[0]);
  const current = row ? { id: row.provider_user_id as string, username: row.provider_username as string, linkedAt: row.linked_at as string } : null;
  let notice: string | null = null;

  if (identity && current && identity.id === current.id) {
    if (identity.username !== current.username) {
      await admin
        .from('linked_accounts')
        .update({ provider_username: identity.username, refreshed_at: new Date().toISOString() })
        .eq('profile_id', profileId)
        .eq('provider', 'github');
      current.username = identity.username;
    }
    return { account: current, locked, notice };
  }

  if (identity && !current) {
    const { data, error } = await admin
      .from('linked_accounts')
      .insert({ profile_id: profileId, provider: 'github', provider_user_id: identity.id, provider_username: identity.username })
      .select('linked_at')
      .single();
    if (error) return { account: null, locked, notice: friendly(error) };
    await admin.from('audit_log').insert({ actor_kind: 'user', actor_id: profileId, action: 'account.link', entity_type: 'github', entity_id: identity.id, details: { username: identity.username } });
    return { account: { ...identity, linkedAt: data.linked_at as string }, locked, notice };
  }

  if (identity && current) {
    // Switched GitHub accounts outside CodeStreak.
    if (locked) return { account: current, locked, notice: LOCKED };
    const { error } = await admin
      .from('linked_accounts')
      .update({ provider_user_id: identity.id, provider_username: identity.username, linked_at: new Date().toISOString(), refreshed_at: new Date().toISOString() })
      .eq('profile_id', profileId)
      .eq('provider', 'github');
    if (error) return { account: current, locked, notice: friendly(error) };
    await admin.from('audit_log').insert({ actor_kind: 'user', actor_id: profileId, action: 'account.switch', entity_type: 'github', entity_id: identity.id, details: { from: current.id } });
    return { account: { ...identity, linkedAt: new Date().toISOString() }, locked, notice };
  }

  if (!identity && current) {
    // Unlinked outside CodeStreak: honoured only when not locked.
    if (locked) return { account: current, locked, notice };
    const { error } = await admin.from('linked_accounts').delete().eq('profile_id', profileId).eq('provider', 'github');
    if (error) return { account: current, locked, notice: friendly(error) };
    return { account: null, locked, notice };
  }

  return { account: null, locked, notice };
}

/** Removes CodeStreak's record (the browser then removes the Supabase identity). Refused while locked. */
export async function unlinkGithub(profileId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from('linked_accounts').delete().eq('profile_id', profileId).eq('provider', 'github').select('provider_user_id');
  if (error) return { ok: false, error: friendly(error) };
  if (data?.length) {
    await admin.from('audit_log').insert({ actor_kind: 'user', actor_id: profileId, action: 'account.unlink', entity_type: 'github', entity_id: data[0]!.provider_user_id as string, details: {} });
  }
  return { ok: true };
}

/** Providers linked to the profile (for join requirements). */
export async function linkedProviders(profileId: string): Promise<('github' | 'leetcode')[]> {
  const { data } = await createSupabaseAdminClient().from('linked_accounts').select('provider').eq('profile_id', profileId);
  return (data ?? []).map((r) => r.provider as 'github' | 'leetcode');
}
