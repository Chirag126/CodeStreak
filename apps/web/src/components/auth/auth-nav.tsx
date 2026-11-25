'use client';

import { UserRound } from 'lucide-react';
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
  const pathname = usePathname();

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return;
    const supabase = createSupabaseBrowserClient();
    const load = async (userId: string | undefined) => {
      setSignedIn(Boolean(userId));
      if (!userId) return setUsername(null);
      // Own profile row (RLS: you can read yours). No username yet → no profile link.
      const { data } = await supabase.from('profiles').select('username').eq('id', userId).maybeSingle();
      setUsername((data?.username as string | null) ?? null);
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
