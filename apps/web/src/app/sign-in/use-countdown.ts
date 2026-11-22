'use client';

import { useEffect, useState } from 'react';

/** Seconds left until `until` (ms epoch), ticking every second; 0 when there is nothing to wait for. */
export function useCountdown(until: number | undefined): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!until) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [until]);
  return until ? left : 0;
}
