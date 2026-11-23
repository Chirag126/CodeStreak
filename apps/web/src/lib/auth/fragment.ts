/** Parses the URL fragment Supabase's implicit flow returns (`#access_token=…` or `#error=…`). */
export type AuthFragment =
  | { kind: 'session'; accessToken: string; refreshToken: string }
  | { kind: 'error'; code: string; description: string }
  | { kind: 'none' };

export function parseAuthFragment(hash: string): AuthFragment {
  const p = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  const accessToken = p.get('access_token');
  const refreshToken = p.get('refresh_token');
  if (accessToken && refreshToken) return { kind: 'session', accessToken, refreshToken };
  const code = p.get('error_code') ?? p.get('error');
  if (code) return { kind: 'error', code, description: p.get('error_description') ?? '' };
  return { kind: 'none' };
}

export function authErrorMessage(code: string): string {
  if (code === 'otp_expired' || code === 'access_denied') {
    return 'That sign-in link was already used or has expired. Each link works once, and only the newest one. Apps that show link previews (WhatsApp, Telegram, Slack, Teams, some mail scanners) open the link before you do, so open it straight from the email instead of sharing or forwarding it. Request a new link below.';
  }
  return 'That sign-in link did not work. Request a new one.';
}
