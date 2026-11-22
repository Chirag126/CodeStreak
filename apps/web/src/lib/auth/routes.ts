// Route guard rules, shared by the proxy (every request) and tested on their own.

export const SIGN_IN_PATH = '/sign-in';
export const USERNAME_PATH = '/onboarding/username';
export const HOME_AFTER_SIGN_IN = '/dashboard';

/** Pages that need a signed-in user. */
const PROTECTED_PREFIXES = ['/dashboard', '/onboarding', '/challenges/new'];

export type ViewerState = { signedIn: false } | { signedIn: true; hasUsername: boolean };

export function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Accepts only same-site relative paths (no open redirects), and never back to auth pages. */
export function safeNext(next: string | null | undefined, fallback = HOME_AFTER_SIGN_IN): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  if (next === SIGN_IN_PATH || next.startsWith(`${SIGN_IN_PATH}?`) || next.startsWith(USERNAME_PATH)) return fallback;
  return next;
}

/**
 * Where to send a request, or null to let it through.
 * - signed out on a protected page -> sign-in (remembering where they were going)
 * - signed in without a username -> the username step first
 * - signed in with a username -> never back to sign-in or the username step
 */
export function routeDecision(pathname: string, search: string, viewer: ViewerState): string | null {
  const here = `${pathname}${search}`;
  if (!viewer.signedIn) {
    return isProtected(pathname) ? `${SIGN_IN_PATH}?next=${encodeURIComponent(here)}` : null;
  }
  const next = new URLSearchParams(search).get('next');
  if (!viewer.hasUsername) {
    if (pathname === USERNAME_PATH) return null;
    if (pathname === SIGN_IN_PATH) return `${USERNAME_PATH}?next=${encodeURIComponent(safeNext(next))}`;
    return isProtected(pathname) ? `${USERNAME_PATH}?next=${encodeURIComponent(here)}` : null;
  }
  if (pathname === SIGN_IN_PATH || pathname === USERNAME_PATH) return safeNext(next);
  return null;
}
