import { describe, expect, it } from 'vitest';
import { githubAccountFromIdentity, missingProviders } from './accounts.js';

describe('GitHub identity', () => {
  it('reads the numeric ID and username', () => {
    expect(githubAccountFromIdentity({ provider: 'github', id: '583231', identity_data: { provider_id: '583231', user_name: 'octocat' } })).toEqual({ id: '583231', username: 'octocat' });
    expect(githubAccountFromIdentity({ provider: 'github', identity_data: { sub: 583231, preferred_username: 'octo-cat' } })).toEqual({ id: '583231', username: 'octo-cat' });
  });

  it('rejects non-GitHub, non-numeric or malformed identities', () => {
    expect(githubAccountFromIdentity({ provider: 'email', identity_data: { sub: '583231', user_name: 'x' } })).toBeNull();
    expect(githubAccountFromIdentity({ provider: 'github', identity_data: { provider_id: 'octocat', user_name: 'octocat' } })).toBeNull();
    expect(githubAccountFromIdentity({ provider: 'github', identity_data: { provider_id: '0583231', user_name: 'octocat' } })).toBeNull();
    expect(githubAccountFromIdentity({ provider: 'github', identity_data: { provider_id: '1', user_name: '-bad' } })).toBeNull();
    expect(githubAccountFromIdentity(null)).toBeNull();
  });
});

describe('provider requirements', () => {
  it('needs every provider for "all" and single-provider rules', () => {
    expect(missingProviders({ providers: ['github'] }, [])).toEqual({ ok: false, need: ['github'], rule: 'all' });
    expect(missingProviders({ providers: ['github'] }, ['github'])).toEqual({ ok: true });
    expect(missingProviders({ providers: ['github', 'leetcode'], providerRule: 'all' }, ['github'])).toEqual({ ok: false, need: ['leetcode'], rule: 'all' });
  });

  it('needs one of them for "any"', () => {
    expect(missingProviders({ providers: ['github', 'leetcode'], providerRule: 'any' }, ['leetcode'])).toEqual({ ok: true });
    expect(missingProviders({ providers: ['github', 'leetcode'], providerRule: 'any' }, [])).toMatchObject({ ok: false, rule: 'any' });
  });

  it('asks for nothing when the rules list no providers', () => {
    expect(missingProviders(null, [])).toEqual({ ok: true });
  });
});
