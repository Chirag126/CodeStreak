'use client';

import { useEffect } from 'react';
import { parseAuthFragment } from '@/lib/auth/fragment';

/**
 * Safety net: if Supabase falls back to the Site URL (for example when a redirect URL isn't
 * allowlisted), the sign-in tokens or error land on whatever page that is. Forward them to the
 * confirm page instead of silently ignoring them.
 */
export function AuthFragmentForwarder() {
  useEffect(() => {
    if (window.location.pathname === '/auth/confirm') return;
    if (parseAuthFragment(window.location.hash).kind !== 'none') {
      window.location.replace(`/auth/confirm${window.location.hash}`);
    }
  }, []);
  return null;
}
