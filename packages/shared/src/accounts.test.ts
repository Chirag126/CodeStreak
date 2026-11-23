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

describe('LeetCode handles', () => {
  it('accepts plain names and pasted profile links', async () => {
    const { normalizeLeetcodeHandle } = await import('./accounts.js');
    for (const [input, out] of [
      ['alice_99', 'alice_99'],
      ['@Alice-99', 'Alice-99'],
      ['https://leetcode.com/u/Alice/', 'Alice'],
      ['leetcode.com/alice', 'alice'],
      ['https://www.leetcode.com/u/bob/?tab=x', 'bob'],
    ] as const) {
      expect(normalizeLeetcodeHandle(input)).toBe(out);
    }
  });

  it('rejects other sites, paths and bad characters', async () => {
    const { normalizeLeetcodeHandle } = await import('./accounts.js');
    for (const bad of ['https://leetcode.cn/u/alice/', 'https://github.com/alice', 'alice/../x', 'al ice', 'ali$ce', '', 'a'.repeat(41)]) {
      expect(normalizeLeetcodeHandle(bad)).toBeNull();
    }
  });
});

describe('describeDailyGoal', () => {
  it('says exactly what counts, joined by the rule', async () => {
    const { describeDailyGoal } = await import('./accounts.js');
    expect(describeDailyGoal({ providers: ['github', 'leetcode'], providerRule: 'any', github: { minMeaningfulLines: 15 }, leetcode: { minNewSolves: 1, minDifficulty: 'any' } })).toBe(
      'a GitHub push with at least 15 meaningful lines or a new LeetCode problem solved',
    );
    expect(describeDailyGoal({ providers: ['github', 'leetcode'], providerRule: 'all', leetcode: { minNewSolves: 2, minDifficulty: 'medium' } })).toBe(
      'a GitHub push with at least 15 meaningful lines and 2 new Medium+ LeetCode problems solved',
    );
    expect(describeDailyGoal(null)).toBe('');
  });
});
