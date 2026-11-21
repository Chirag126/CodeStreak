'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

/** Header entry point: "Sign in" or "Dashboard". Display only; the proxy enforces access. */
export function AuthNav() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return;
    const supabase = createSupabaseBrowserClient();
    void supabase.auth.getSession().then(({ data }) => setSignedIn(Boolean(data.session)));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(Boolean(session)));
    return () => data.subscription.unsubscribe();
  }, []);

  if (signedIn === null) return null;
  return (
    <Button asChild size="sm" variant={signedIn ? 'secondary' : 'default'}>
      <Link href={signedIn ? '/dashboard' : '/sign-in'}>{signedIn ? 'Dashboard' : 'Sign in'}</Link>
    </Button>
  );
}
