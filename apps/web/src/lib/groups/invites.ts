import 'server-only';

import { INVITE_LINK_LIMITS, INVITE_TOKEN_PATTERN, inviteLinkProblem, LINK_PROBLEM_MESSAGES, normalizePublicId, type InviteStatus } from '@codestreak/shared';
import { createHash, randomBytes } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export type GroupResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const hashInviteToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');

async function audit(actorId: string, action: string, entityId: string, details: Record<string, unknown> = {}) {
  await createSupabaseAdminClient().from('audit_log').insert({ actor_kind: 'user', actor_id: actorId, action, entity_type: 'challenge', entity_id: entityId, details });
}

/** The private group at `address`, if `viewerId` created it (only creators manage invitations). */
async function ownedPrivateGroup(viewerId: string, address: string) {
  const { data } = await createSupabaseAdminClient()
    .from('challenges')
    .select('id, title, creator_id, visibility, onchain_address, join_deadline_at')
    .eq('onchain_address', address)
    .maybeSingle();
  if (!data || data.visibility !== 'private') return { error: 'Private group not found.' } as const;
  if (data.creator_id !== viewerId) return { error: 'Only the group creator can manage invitations.' } as const;
  if (Date.parse(data.join_deadline_at as string) <= Date.now()) return { error: 'Joining has closed for this group.' } as const;
  return { group: data } as const;
}

/** Invite a friend by their public ID: a pending invitation they accept or decline. */
export async function inviteByPublicId(viewerId: string, address: string, rawPublicId: string): Promise<GroupResult<{ name: string }>> {
  const owned = await ownedPrivateGroup(viewerId, address);
  if ('error' in owned) return { ok: false, error: owned.error! };
  const publicId = normalizePublicId(rawPublicId);
  if (!publicId) return { ok: false, error: 'That is not a CodeStreak public ID (it looks like CS-7KQ2M9XA).' };

  const admin = createSupabaseAdminClient();
  const { data: friend } = await admin.from('profiles').select('id, username, display_name').eq('public_id', publicId).maybeSingle();
  if (!friend) return { ok: false, error: `Nobody has the public ID ${publicId}.` };
  if (friend.id === viewerId) return { ok: false, error: 'You are already in your own group.' };
  const { count: member } = await admin.from('memberships').select('id', { count: 'exact', head: true }).eq('challenge_id', owned.group.id).eq('profile_id', friend.id);
  if (member) return { ok: false, error: 'They already joined.' };

  const { error } = await admin.from('invitations').insert({ challenge_id: owned.group.id, invited_by: viewerId, invitee_id: friend.id });
  if (error?.code === '23505') return { ok: false, error: 'They already have an invitation to this group.' };
  if (error) return { ok: false, error: 'Could not send the invitation. Try again.' };
  await audit(viewerId, 'group.invite', address, { invitee: publicId });
  return { ok: true, name: (friend.display_name as string | null) ?? (friend.username as string | null) ?? publicId };
}

/**
 * Creates an invite link. The token (256 random bits) is returned once and never stored: the
 * database keeps only its SHA-256. Links always expire and have a use limit (single-use by default).
 */
export async function createInviteLink(viewerId: string, address: string, opts: { maxUses: number; hours: number }, appUrl: string): Promise<GroupResult<{ url: string; expiresAt: string }>> {
  const owned = await ownedPrivateGroup(viewerId, address);
  if ('error' in owned) return { ok: false, error: owned.error! };
  const maxUses = Math.trunc(opts.maxUses);
  const hours = Math.trunc(opts.hours);
  if (!(maxUses >= 1 && maxUses <= INVITE_LINK_LIMITS.maxUses)) return { ok: false, error: `Uses must be between 1 and ${INVITE_LINK_LIMITS.maxUses}.` };
  if (!(hours >= 1 && hours <= INVITE_LINK_LIMITS.maxHours)) return { ok: false, error: 'Expiry must be between 1 hour and 30 days.' };

  // A link never outlives the group's joining window.
  const expiresAt = new Date(Math.min(Date.now() + hours * 3_600_000, Date.parse(owned.group.join_deadline_at as string)));
  const token = randomBytes(32).toString('base64url');
  const { error } = await createSupabaseAdminClient()
    .from('invitations')
    .insert({ challenge_id: owned.group.id, invited_by: viewerId, code_hash: hashInviteToken(token), max_uses: maxUses, expires_at: expiresAt.toISOString() });
  if (error) return { ok: false, error: 'Could not create the link. Try again.' };
  await audit(viewerId, 'group.link_create', address, { maxUses, expiresAt: expiresAt.toISOString() });
  return { ok: true, url: `${appUrl.replace(/\/$/, '')}/invite/${token}`, expiresAt: expiresAt.toISOString() };
}

/** Creator turns off a link or withdraws a pending invitation. */
export async function revokeInvite(viewerId: string, inviteId: string): Promise<GroupResult> {
  const { data, error } = await createSupabaseAdminClient()
    .from('invitations')
    .update({ status: 'revoked', responded_at: new Date().toISOString() })
    .eq('id', inviteId)
    .eq('invited_by', viewerId)
    .eq('status', 'pending')
    .select('id');
  if (error || !data?.length) return { ok: false, error: 'Could not revoke that invitation.' };
  return { ok: true };
}

/** Invitee accepts or declines a pending invitation (declining removes access to the group). */
export async function respondToInvite(viewerId: string, inviteId: string, answer: 'accept' | 'decline'): Promise<GroupResult> {
  const { data, error } = await createSupabaseAdminClient()
    .from('invitations')
    .update({ status: answer === 'accept' ? 'accepted' : 'declined', responded_at: new Date().toISOString() })
    .eq('id', inviteId)
    .eq('invitee_id', viewerId)
    .eq('status', 'pending')
    .select('challenge_id');
  if (error || !data?.length) return { ok: false, error: 'That invitation is no longer pending.' };
  await audit(viewerId, `group.invite_${answer}`, data[0]!.challenge_id as string);
  return { ok: true };
}

/** Public preview for the invite page (title only), without consuming anything. */
export async function previewInviteLink(token: string): Promise<GroupResult<{ title: string; address: string }>> {
  if (!INVITE_TOKEN_PATTERN.test(token)) return { ok: false, error: LINK_PROBLEM_MESSAGES.invalid };
  const admin = createSupabaseAdminClient();
  const { data: link } = await admin
    .from('invitations')
    .select('status, expires_at, max_uses, use_count, challenges(title, onchain_address)')
    .eq('code_hash', hashInviteToken(token))
    .maybeSingle();
  if (!link) return { ok: false, error: LINK_PROBLEM_MESSAGES.invalid };
  const problem = inviteLinkProblem(
    { status: link.status as InviteStatus, expiresAt: new Date(link.expires_at as string), maxUses: link.max_uses as number, useCount: link.use_count as number },
    new Date(),
  );
  if (problem) return { ok: false, error: LINK_PROBLEM_MESSAGES[problem] };
  const group = link.challenges as unknown as { title: string; onchain_address: string };
  return { ok: true, title: group.title, address: group.onchain_address };
}

/**
 * Redeems a link for the signed-in user: consumes one use with an optimistic-lock update (only
 * succeeds if nobody else used it meanwhile and it is still live), then gives the user an accepted
 * invitation. Someone already invited or in the group doesn't consume a use.
 */
export async function redeemInviteLink(viewerId: string, token: string): Promise<GroupResult<{ address: string }>> {
  if (!INVITE_TOKEN_PATTERN.test(token)) return { ok: false, error: LINK_PROBLEM_MESSAGES.invalid };
  const admin = createSupabaseAdminClient();
  const { data: link } = await admin
    .from('invitations')
    .select('id, challenge_id, invited_by, status, expires_at, max_uses, use_count, challenges(onchain_address)')
    .eq('code_hash', hashInviteToken(token))
    .maybeSingle();
  if (!link) return { ok: false, error: LINK_PROBLEM_MESSAGES.invalid };
  const address = (link.challenges as unknown as { onchain_address: string }).onchain_address;

  if (link.invited_by === viewerId) return { ok: true, address };
  const { count: live } = await admin
    .from('invitations')
    .select('id', { count: 'exact', head: true })
    .eq('challenge_id', link.challenge_id)
    .eq('invitee_id', viewerId)
    .in('status', ['pending', 'accepted']);
  if (live) return { ok: true, address }; // already invited: nothing consumed

  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: current } = await admin.from('invitations').select('status, expires_at, max_uses, use_count').eq('id', link.id).single();
    if (!current) return { ok: false, error: LINK_PROBLEM_MESSAGES.invalid };
    const problem = inviteLinkProblem(
      { status: current.status as InviteStatus, expiresAt: new Date(current.expires_at as string), maxUses: current.max_uses as number, useCount: current.use_count as number },
      new Date(),
    );
    if (problem) return { ok: false, error: LINK_PROBLEM_MESSAGES[problem] };
    const { data: consumed } = await admin
      .from('invitations')
      .update({ use_count: (current.use_count as number) + 1 })
      .eq('id', link.id)
      .eq('use_count', current.use_count as number)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .select('id');
    if (!consumed?.length) continue; // someone else used it at the same moment: re-check

    const { error } = await admin
      .from('invitations')
      .insert({ challenge_id: link.challenge_id, invited_by: link.invited_by, invitee_id: viewerId, status: 'accepted', responded_at: new Date().toISOString(), via_link: link.id });
    if (error && error.code !== '23505') return { ok: false, error: 'Could not add you to the group. Try again.' };
    await audit(viewerId, 'group.link_redeem', address, { link: link.id });
    return { ok: true, address };
  }
  return { ok: false, error: LINK_PROBLEM_MESSAGES.used_up };
}

/** The creator's view of a group's invitations (newest first). */
export async function listGroupInvites(viewerId: string, challengeId: string) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('invitations')
    .select('id, invitee_id, status, max_uses, use_count, expires_at, created_at')
    .eq('challenge_id', challengeId)
    .eq('invited_by', viewerId)
    .order('created_at', { ascending: false })
    .limit(50);
  const rows = data ?? [];
  const ids = rows.map((r) => r.invitee_id).filter(Boolean) as string[];
  const { data: people } = ids.length ? await admin.from('profiles').select('id, public_id, display_name, username').in('id', ids) : { data: [] };
  const byId = new Map((people ?? []).map((p) => [p.id as string, p]));
  const now = new Date();
  return rows.map((r) => {
    if (r.invitee_id) {
      const p = byId.get(r.invitee_id as string);
      return { id: r.id as string, kind: 'person' as const, label: (p?.display_name as string | null) ?? (p?.username as string | null) ?? 'Friend', status: r.status as string, detail: (p?.public_id as string | undefined) ?? '' };
    }
    const problem = inviteLinkProblem({ status: r.status as InviteStatus, expiresAt: new Date(r.expires_at as string), maxUses: r.max_uses as number, useCount: r.use_count as number }, now);
    const status = problem === 'expired' ? 'expired' : problem === 'used_up' ? 'used' : (r.status as string);
    return { id: r.id as string, kind: 'link' as const, label: 'Invite link', status, detail: `${r.use_count}/${r.max_uses} used · expires ${new Date(r.expires_at as string).toUTCString()}` };
  });
}

/** Pending invitations addressed to the viewer, for the dashboard. */
export async function listMyInvites(viewerId: string) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('invitations')
    .select('id, created_at, challenges(title, onchain_address, join_deadline_at), inviter:profiles!invitations_invited_by_fkey(public_id, display_name, username)')
    .eq('invitee_id', viewerId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(20);
  return (data ?? []).map((i) => {
    const c = i.challenges as unknown as { title: string; onchain_address: string; join_deadline_at: string };
    const by = i.inviter as unknown as { public_id: string; display_name: string | null; username: string | null } | null;
    return { id: i.id as string, title: c.title, address: c.onchain_address, joinUntil: c.join_deadline_at, from: by?.display_name ?? by?.username ?? by?.public_id ?? 'A friend' };
  });
}
