import { describe, expect, it } from 'vitest';
import { normalizeUsername, usernameErrorFromDb, usernameSchema } from './username.js';

const check = (v: string) => usernameSchema.safeParse(v);

describe('username rules', () => {
  it('normalizes case and whitespace', () => {
    expect(normalizeUsername('  Chirag_126 ')).toBe('chirag_126');
    expect(check('  Chirag_126 ')).toMatchObject({ success: true, data: 'chirag_126' });
  });

  it('matches the database pattern', () => {
    for (const ok of ['abc', 'a_b_c', 'user123', 'x'.repeat(20)]) expect(check(ok).success).toBe(true);
    for (const bad of ['ab', 'x'.repeat(21), 'has space', 'dash-name', 'émoji', 'dot.name', '']) expect(check(bad).success).toBe(false);
  });

  it('rejects reserved names in any case', () => {
    for (const r of ['admin', 'Admin', 'CODESTREAK', 'support']) {
      const r1 = check(r);
      expect(r1.success).toBe(false);
      expect(r1.error?.issues[0]?.message).toBe('That username is reserved.');
    }
  });

  it('maps database errors: a taken username is reported as taken', () => {
    expect(usernameErrorFromDb({ code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_key"' })).toBe(
      'That username is taken.',
    );
    expect(usernameErrorFromDb({ code: '23514' })).toBe('That username is not allowed.');
    expect(usernameErrorFromDb({ code: 'XX000' })).toMatch(/try again/);
    expect(usernameErrorFromDb(null)).toBeNull();
  });
});
