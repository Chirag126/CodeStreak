import { NextResponse, type NextRequest } from 'next/server';
import { appOrigin } from '@/lib/app-origin';
import { safeNext, SIGN_IN_PATH, USERNAME_PATH } from '@/lib/auth/routes';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const OTP_TYPES: ReadonlySet<string> = new Set(['email', 'magiclink', 'signup']);

/**
 * Where the sign-in email's link lands. Supabase's default templates send a link (not a code) on
 * the free plan, so this completes sign-in from it:
 *   - `?code=`                (PKCE, default {{ .ConfirmationURL }} templates)
 *   - `?token_hash=&type=`    (custom templates): handed to /auth/confirm, which spends it on a click
 * then continues to the username step or the page the user was heading to.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const origin = appOrigin(url.origin);
  const next = safeNext(url.searchParams.get('next'));
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');

  const supabase = await createSupabaseServerClient();

  // Identity linking (e.g. GitHub) that GitHub or Supabase refused: back to the page that started
  // it with a short code, while the user stays signed in. Only CodeStreak codes are passed on.
  const oauthError = url.searchParams.get('error_code') ?? url.searchParams.get('error');
  if (oauthError && next.startsWith('/dashboard/settings')) {
    const codeSafe = /^[a-z_]{1,64}$/.test(oauthError) ? oauthError : 'unknown';
    const target = new URL('/dashboard/settings', origin);
    target.searchParams.set('link_error', codeSafe);
    return NextResponse.redirect(target);
  }

  // Email token links are never used up by a GET (link previews and mail scanners send GETs):
  // the confirm page uses them only when the person presses Continue.
  if (tokenHash && type && OTP_TYPES.has(type)) {
    const target = new URL('/auth/confirm', origin);
    target.searchParams.set('next', next);
    target.searchParams.set('token_hash', tokenHash);
    target.searchParams.set('type', type);
    return NextResponse.redirect(target);
  }

  let error: unknown = 'missing';
  if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  }
  if (error) return NextResponse.redirect(new URL(`${SIGN_IN_PATH}?error=link`, origin));

  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  const { data: profile } = userId
    ? await supabase.from('profiles').select('username').eq('id', userId).maybeSingle()
    : { data: null };
  const target = profile?.username ? next : `${USERNAME_PATH}?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(new URL(target, origin));
}
