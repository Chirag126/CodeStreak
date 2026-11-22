// Private-group invitation rules (pure). Token generation and hashing happen on the server.

export const PUBLIC_ID_PATTERN = /^CS-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;

export const INVITE_LINK_LIMITS = {
  /** Links are single-use unless the creator allows more. */
  defaultMaxUses: 1,
  maxUses: 20,
  defaultHours: 72,
  maxHours: 30 * 24,
} as const;

/** Raw link tokens: 32 random bytes, base64url (43 characters). */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Accepts "cs-7kq2 m9xa" style input and returns the canonical "CS-7KQ2M9XA", or null. */
export function normalizePublicId(raw: string): string | null {
  const compact = raw.toUpperCase().replace(/[\s-]+/g, '');
  // "CS" + 8 characters, or just the 8 characters (which may themselves start with C or S).
  const body = compact.length === 10 && compact.startsWith('CS') ? compact.slice(2) : compact;
  const id = `CS-${body}`;
  return PUBLIC_ID_PATTERN.test(id) ? id : null;
}

export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';

export type LinkProblem = 'revoked' | 'expired' | 'used_up';

/** Why an invite link can't be redeemed right now, or null if it can. */
export function inviteLinkProblem(link: { status: InviteStatus; expiresAt: Date; maxUses: number; useCount: number }, now: Date): LinkProblem | null {
  if (link.status === 'revoked') return 'revoked';
  if (link.status === 'expired' || now.getTime() >= link.expiresAt.getTime()) return 'expired';
  if (link.useCount >= link.maxUses) return 'used_up';
  return null;
}

export const LINK_PROBLEM_MESSAGES: Record<LinkProblem | 'invalid', string> = {
  invalid: 'This invite link is not valid. Ask the group for a new one.',
  revoked: 'This invite link was turned off by the group.',
  expired: 'This invite link has expired. Ask the group for a new one.',
  used_up: 'This invite link has already been used. Ask the group for a new one.',
};

/** Only a live invitation lets someone see or join a private group. */
export function invitationAllowsJoin(status: InviteStatus | null | undefined): boolean {
  return status === 'pending' || status === 'accepted';
}
