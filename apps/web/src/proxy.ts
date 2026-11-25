// Next.js 16 proxy (formerly "middleware"): refreshes the Supabase session cookie on every request
// and applies the route guard (lib/auth/routes.ts).
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { appOrigin } from '@/lib/app-origin';
import { isProtected, routeDecision, SIGN_IN_PATH, USERNAME_PATH, type ViewerState } from '@/lib/auth/routes';

export async function proxy(request: NextRequest) {
  const origin = appOrigin(request.nextUrl.origin);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    // Misconfigured deployment: fail closed for protected pages.
    return isProtected(request.nextUrl.pathname) ? NextResponse.redirect(new URL('/', origin)) : NextResponse.next();
  }

  // Safety net for old PKCE links that fell back to the Site URL: finish them on the callback.
  const stray = request.nextUrl.searchParams.get('code');
  if (stray && request.nextUrl.pathname !== '/auth/callback') {
    const to = new URL('/auth/callback', origin);
    to.searchParams.set('code', stray);
    to.searchParams.set('next', request.nextUrl.pathname === '/' ? '/dashboard' : request.nextUrl.pathname);
    return NextResponse.redirect(to);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });

  // Must run right after creating the client: verifies the token and refreshes it if needed.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  const { pathname, search } = request.nextUrl;
  let viewer: ViewerState = { signedIn: false };
  if (userId) {
    // Only pages whose guard depends on the username pay for this lookup.
    const needsProfile = isProtected(pathname) || pathname === SIGN_IN_PATH || pathname === USERNAME_PATH;
    let hasUsername = true;
    let blocked = false;
    if (needsProfile) {
      const [{ data: profile }, { data: status }] = await Promise.all([
        supabase.from('profiles').select('username').eq('id', userId).maybeSingle(),
        // Moderation (Phase 37.1): the user's own effective status, via a narrow definer function.
        supabase.rpc('my_account_status'),
      ]);
      hasUsername = Boolean(profile?.username);
      const s = (status as { status?: string } | null)?.status;
      blocked = s === 'suspended' || s === 'banned' || s === 'pending_deletion' || s === 'deleted';
    }
    viewer = { signedIn: true, hasUsername, blocked };
  }

  const target = routeDecision(pathname, search, viewer);
  if (!target) return response;
  const redirect = NextResponse.redirect(new URL(target, origin));
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  // Everything except static assets, images and the health check.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health|api/badges|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
