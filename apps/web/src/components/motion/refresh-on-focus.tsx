'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

/** Re-reads the page's server data when the tab comes back into view (at most every 15 s). */
export function RefreshOnFocus() {
  const router = useRouter();
  const last = useRef(Date.now());
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last.current < 15_000) return;
      last.current = Date.now();
      router.refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [router]);
  return null;
}
