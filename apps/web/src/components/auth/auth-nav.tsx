'use client';

import { ShieldCheck, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Header entry points: "Sign in", or "Profile" (your public page) + "Dashboard". Display only; the
 * proxy enforces access. Sign-in and sign-out finish on the server (cookies), which the browser client
 * doesn't hear about, so the session is re-read from the cookies on every navigation as well.
 */
export function AuthNav() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [owner, setOwner] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return;
    const supabase = createSupabaseBrowserClient();
    const load = async (userId: string | undefined) => {
      setSignedIn(Boolean(userId));
      if (!userId) {
        setOwner(false);
        return setUsername(null);
      }
      // Own profile row (RLS: you can read yours). No username yet → no profile link.
      // am_i_admin is true only for the single owner row; the /admin pages re-check on the server.
      const [{ data }, { data: isOwner }] = await Promise.all([supabase.from('profiles').select('username').eq('id', userId).maybeSingle(), supabase.rpc('am_i_admin')]);
      setUsername((data?.username as string | null) ?? null);
      setOwner(isOwner === true);
    };
    void supabase.auth.getSession().then(({ data }) => load(data.session?.user.id));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => void load(session?.user.id));
    return () => data.subscription.unsubscribe();
  }, [pathname]);

  if (signedIn === null) return null;
  if (!signedIn) {
    return (
      <Button asChild size="sm">
        <Link href="/sign-in">Sign in</Link>
      </Button>
    );
  }
  const profileHref = username ? `/u/${username}` : null;
  return (
    <>
      {owner && (
        <Button asChild size="sm" variant={pathname.startsWith('/admin') ? 'secondary' : 'ghost'} aria-label="Developer Control Center">
          <Link href="/admin">
            <ShieldCheck className="size-4" aria-hidden />
            <span className="hidden md:inline">Control Center</span>
          </Link>
        </Button>
      )}
      {profileHref && (
        <Button asChild size="sm" variant={pathname === profileHref ? 'secondary' : 'ghost'} aria-label="Your public profile">
          <Link href={profileHref}>
            <UserRound className="size-4" aria-hidden />
            <span className="hidden sm:inline">Profile</span>
          </Link>
        </Button>
      )}
      <Button asChild size="sm" variant="secondary">
        <Link href="/dashboard">Dashboard</Link>
      </Button>
    </>
  );
}
