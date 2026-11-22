import { describe, expect, it } from 'vitest';
import { authErrorMessage, parseAuthFragment } from './fragment';

describe('parseAuthFragment', () => {
  it('reads the session from an implicit-flow link', () => {
    expect(parseAuthFragment('#access_token=a.b.c&expires_in=3600&refresh_token=r1&token_type=bearer&type=magiclink')).toEqual({
      kind: 'session',
      accessToken: 'a.b.c',
      refreshToken: 'r1',
    });
  });
  it('reads an expired-link error', () => {
    const f = parseAuthFragment('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    expect(f).toEqual({ kind: 'error', code: 'otp_expired', description: 'Email link is invalid or has expired' });
    expect(authErrorMessage('otp_expired')).toMatch(/newest link/);
  });
  it('ignores ordinary anchors', () => {
    expect(parseAuthFragment('#rules')).toEqual({ kind: 'none' });
    expect(parseAuthFragment('')).toEqual({ kind: 'none' });
  });
});
