// Phase 37.1 - the single owner identity, as a pure, tested check (no I/O here).
//
// Configured on the server only (never NEXT_PUBLIC_):
//   CODESTREAK_OWNER_ID            the owner's auth user id (uuid)                  - required
//   CODESTREAK_OWNER_EMAIL_SHA256  sha256(lowercased email), hex                    - preferred
//   CODESTREAK_OWNER_EMAIL         the email itself (used only if no hash is set)
// Fails closed: anything missing or malformed means nobody is the owner.
import { createHash, timingSafeEqual } from 'node:crypto';

export interface OwnerConfig {
  id: string | undefined;
  emailSha256: string | undefined;
  email: string | undefined;
}

export interface SessionIdentity {
  id: string;
  email: string | null | undefined;
  emailConfirmedAt: string | null | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Constant-time string equality (compares digests, so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}

export function ownerConfigFromEnv(env: Record<string, string | undefined> = process.env): OwnerConfig {
  return { id: env.CODESTREAK_OWNER_ID?.trim().toLowerCase(), emailSha256: env.CODESTREAK_OWNER_EMAIL_SHA256?.trim().toLowerCase(), email: env.CODESTREAK_OWNER_EMAIL?.trim() };
}

export function isOwnerIdentity(user: SessionIdentity | null | undefined, cfg: OwnerConfig): boolean {
  if (!user || !cfg.id || !UUID.test(cfg.id)) return false;
  const expectedEmailHash = cfg.emailSha256 && HEX64.test(cfg.emailSha256) ? cfg.emailSha256 : cfg.email ? sha256Hex(cfg.email.toLowerCase()) : null;
  if (!expectedEmailHash) return false;
  if (!user.email || !user.emailConfirmedAt) return false; // an unconfirmed email proves nothing
  const idOk = safeEqual(user.id.toLowerCase(), cfg.id);
  const emailOk = safeEqual(sha256Hex(user.email.trim().toLowerCase()), expectedEmailHash);
  return idOk && emailOk;
}

/** Sensitive actions need a sign-in within this many minutes. */
export const RECENT_AUTH_MINUTES = 30;

export function isRecentSignIn(lastSignInAt: string | null | undefined, nowMs: number, minutes = RECENT_AUTH_MINUTES): boolean {
  if (!lastSignInAt) return false;
  const t = Date.parse(lastSignInAt);
  return Number.isFinite(t) && t <= nowMs + 60_000 && nowMs - t <= minutes * 60_000;
}

/** Actions that need a recent sign-in (irreversible, or they change identity). */
export const SENSITIVE_ACTIONS = new Set(['ban', 'schedule_deletion', 'finalize_deletion']);
export function isSensitive(action: string, params: Record<string, unknown>): boolean {
  return SENSITIVE_ACTIONS.has(action) || (action === 'suspend' && params.permanent === true) || (action === 'edit_profile' && 'username' in params);
}
