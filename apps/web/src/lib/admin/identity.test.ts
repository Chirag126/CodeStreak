import { describe, expect, it } from 'vitest';
import { isOwnerIdentity, isRecentSignIn, isSensitive, ownerConfigFromEnv, sha256Hex } from './identity';

const ID = 'b02bf5c0-1cb8-4b7a-a35c-cb340e92a845';
const EMAIL = 'Owner@Example.com';
const user = { id: ID, email: 'owner@example.com', emailConfirmedAt: '2026-11-01T00:00:00Z' };

describe('owner identity', () => {
  const byHash = ownerConfigFromEnv({ CODESTREAK_OWNER_ID: ID, CODESTREAK_OWNER_EMAIL_SHA256: sha256Hex(EMAIL.toLowerCase()) });
  const byEmail = ownerConfigFromEnv({ CODESTREAK_OWNER_ID: ID, CODESTREAK_OWNER_EMAIL: EMAIL });

  it('accepts only the configured id AND confirmed email (hash or plain config)', () => {
    expect(isOwnerIdentity(user, byHash)).toBe(true);
    expect(isOwnerIdentity(user, byEmail)).toBe(true);
    expect(isOwnerIdentity({ ...user, email: 'OWNER@example.com ' }, byHash)).toBe(true);
  });

  it('refuses another id, another email, an unconfirmed email, or no session', () => {
    expect(isOwnerIdentity({ ...user, id: '00000000-0000-0000-0000-000000000001' }, byHash)).toBe(false);
    expect(isOwnerIdentity({ ...user, email: 'someone@example.com' }, byHash)).toBe(false);
    expect(isOwnerIdentity({ ...user, emailConfirmedAt: null }, byHash)).toBe(false);
    expect(isOwnerIdentity(null, byHash)).toBe(false);
  });

  it('fails closed when the configuration is missing or malformed', () => {
    expect(isOwnerIdentity(user, ownerConfigFromEnv({}))).toBe(false);
    expect(isOwnerIdentity(user, ownerConfigFromEnv({ CODESTREAK_OWNER_ID: ID }))).toBe(false);
    expect(isOwnerIdentity(user, ownerConfigFromEnv({ CODESTREAK_OWNER_ID: 'not-a-uuid', CODESTREAK_OWNER_EMAIL: EMAIL }))).toBe(false);
    expect(isOwnerIdentity(user, ownerConfigFromEnv({ CODESTREAK_OWNER_ID: ID, CODESTREAK_OWNER_EMAIL_SHA256: 'xyz' }))).toBe(false);
  });
});

describe('recent sign-in', () => {
  const now = Date.parse('2026-11-25T12:00:00Z');
  it('is required within 30 minutes; future or missing timestamps fail', () => {
    expect(isRecentSignIn('2026-11-25T11:45:00Z', now)).toBe(true);
    expect(isRecentSignIn('2026-11-25T11:00:00Z', now)).toBe(false);
    expect(isRecentSignIn('2026-11-25T13:00:00Z', now)).toBe(false);
    expect(isRecentSignIn(null, now)).toBe(false);
  });
  it('marks irreversible or identity-changing actions as sensitive', () => {
    expect(isSensitive('ban', {})).toBe(true);
    expect(isSensitive('suspend', { permanent: true })).toBe(true);
    expect(isSensitive('suspend', { hours: 24 })).toBe(false);
    expect(isSensitive('edit_profile', { username: 'x' })).toBe(true);
    expect(isSensitive('edit_profile', { bio: 'x' })).toBe(false);
    expect(isSensitive('warn', {})).toBe(false);
  });
});
