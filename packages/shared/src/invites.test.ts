import { describe, expect, it } from 'vitest';
import { invitationAllowsJoin, inviteLinkProblem, normalizePublicId } from './invites.js';

const NOW = new Date('2026-11-23T10:00:00Z');
const link = { status: 'pending' as const, expiresAt: new Date('2026-11-24T10:00:00Z'), maxUses: 1, useCount: 0 };

describe('invite links', () => {
  it('a fresh link can be redeemed', () => {
    expect(inviteLinkProblem(link, NOW)).toBeNull();
  });

  it('rejects an expired link (at and after expiry)', () => {
    expect(inviteLinkProblem(link, link.expiresAt)).toBe('expired');
    expect(inviteLinkProblem(link, new Date('2026-12-01T00:00:00Z'))).toBe('expired');
    expect(inviteLinkProblem({ ...link, status: 'expired' }, NOW)).toBe('expired');
  });

  it('rejects a reused link once its uses are spent', () => {
    expect(inviteLinkProblem({ ...link, useCount: 1 }, NOW)).toBe('used_up');
    expect(inviteLinkProblem({ ...link, maxUses: 5, useCount: 4 }, NOW)).toBeNull();
    expect(inviteLinkProblem({ ...link, maxUses: 5, useCount: 5 }, NOW)).toBe('used_up');
  });

  it('rejects a revoked link', () => {
    expect(inviteLinkProblem({ ...link, status: 'revoked' }, NOW)).toBe('revoked');
  });
});

describe('invitations', () => {
  it('only a live invitation allows joining (an uninvited or declined person cannot)', () => {
    expect(invitationAllowsJoin('pending')).toBe(true);
    expect(invitationAllowsJoin('accepted')).toBe(true);
    for (const s of ['declined', 'revoked', 'expired', null, undefined] as const) expect(invitationAllowsJoin(s)).toBe(false);
  });

  it('normalizes public IDs typed by people', () => {
    expect(normalizePublicId('cs-7kq2m9xa')).toBe('CS-7KQ2M9XA');
    expect(normalizePublicId(' CS 7KQ2 M9XA ')).toBe('CS-7KQ2M9XA');
    expect(normalizePublicId('7KQ2M9XA')).toBe('CS-7KQ2M9XA');
    expect(normalizePublicId('CSABCDEF')).toBe('CS-CSABCDEF');
    for (const bad of ['CS-7KQ2M9X', 'CS-7KQ2M9XO', 'CS-7KQ2M9X1', 'hello', '']) expect(normalizePublicId(bad)).toBeNull();
  });
});
