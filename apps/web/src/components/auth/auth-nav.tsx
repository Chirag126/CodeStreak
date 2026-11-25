'use client';

import { ShieldCheck, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export interface AuthState {
  /** null while loading (nothing is rendered, so there is no flash of the wrong buttons). */
  signedIn: boolean | null;
  username: string | null;
  owner: boolean;
}

/**
 * The signed-in state for the header. Display only; the proxy and the server enforce access.
 * Sign-in and sign-out finish on the server (cookies), which the browser client doesn't hear
 * about, so the session is re-read on every navigation as well.
 */
export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>({ signedIn: null, username: null, owner: false });
  const pathname = usePathname();

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return;
    const supabase = createSupabaseBrowserClient();
    const load = async (userId: string | undefined) => {
      if (!userId) return setState({ signedIn: false, username: null, owner: false });
      // Own profile row (RLS: you can read yours). No username yet → no profile link.
      // am_i_admin is true only for the single owner row; the /admin pages re-check on the server.
      const [{ data }, { data: isOwner }] = await Promise.all([supabase.from('profiles').select('username').eq('id', userId).maybeSingle(), supabase.rpc('am_i_admin')]);
      setState({ signedIn: true, username: (data?.username as string | null) ?? null, owner: isOwner === true });
    };
    void supabase.auth.getSession().then(({ data }) => load(data.session?.user.id));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => void load(session?.user.id));
    return () => data.subscription.unsubscribe();
  }, [pathname]);

  return state;
}

/** Account links for the menu sheet on phones (where the header has no room for them). */
export function accountLinks(state: AuthState): { href: string; label: string }[] {
  if (!state.signedIn) return [];
  return [
    { href: '/dashboard', label: 'Dashboard' },
    ...(state.username ? [{ href: `/u/${state.username}`, label: 'Your profile' }] : []),
    ...(state.owner ? [{ href: '/admin', label: 'Control Center' }] : []),
  ];
}

/**
 * Header entry points: "Sign in", or Control Center (owner only) + Profile + Dashboard. On phones
 * (below md) only "Sign in" stays in the bar; the signed-in links move into the menu sheet.
 */
export function AuthNav({ state }: { state: AuthState }) {
  const pathname = usePathname();
  if (state.signedIn === null) return null;
  if (!state.signedIn) {
    return (
      <Button asChild size="sm">
        <Link href="/sign-in">Sign in</Link>
      </Button>
    );
  }
  const profileHref = state.username ? `/u/${state.username}` : null;
  return (
    <div className="hidden items-center gap-2 md:flex">
      {state.owner && (
        <Button asChild size="sm" variant={pathname.startsWith('/admin') ? 'secondary' : 'ghost'} aria-label="Developer Control Center">
          <Link href="/admin">
            <ShieldCheck className="size-4" aria-hidden />
            <span className="hidden lg:inline">Control Center</span>
          </Link>
        </Button>
      )}
      {profileHref && (
        <Button asChild size="sm" variant={pathname === profileHref ? 'secondary' : 'ghost'} aria-label="Your public profile">
          <Link href={profileHref}>
            <UserRound className="size-4" aria-hidden />
            <span>Profile</span>
          </Link>
        </Button>
      )}
      <Button asChild size="sm" variant="secondary">
        <Link href="/dashboard">Dashboard</Link>
      </Button>
    </div>
  );
}
