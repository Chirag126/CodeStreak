'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Header entry point: "Sign in" or "Dashboard". Display only; the proxy enforces access.
 * Sign-in and sign-out finish on the server (cookies), which the browser client doesn't hear
 * about, so the session is re-read from the cookies on every navigation as well.
 */
export function AuthNav() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const pathname = usePathname();

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return;
    const supabase = createSupabaseBrowserClient();
    void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)));
    return () => data.subscription.unsubscribe();
  }, [pathname]);

  if (signedIn === null) return null;
  return (
    <Button asChild size="sm" variant={signedIn ? 'secondary' : 'default'}>
      <Link href={signedIn ? '/dashboard' : '/sign-in'}>{signedIn ? 'Dashboard' : 'Sign in'}</Link>
    </Button>
  );
}
