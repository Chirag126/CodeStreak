'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { BoardPayload } from '@/lib/board/load';
import { initialLive, liveReducer, retryDelayMs, type LiveEvent } from '@/lib/board/live';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const STATUS_EVENTS = new Set(['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);

/**
 * Keeps a group board up to date: subscribes to the challenge's activity row over Supabase
 * Realtime (RLS applies, so only viewers of the group receive it), re-fetches the board on each
 * change (debounced), resubscribes with backoff after errors, and re-fetches after any disconnect
 * or when the tab becomes visible again so nothing missed while offline is lost.
 */
export function useLiveBoard(address: string, challengeId: string, initial: BoardPayload) {
  const [payload, setPayload] = useState(initial);
  const [live, dispatch] = useReducer(liveReducer, initialLive);
  const [generation, setGeneration] = useState(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/challenges/${address}/board`, { cache: 'no-store' });
      if (res.ok) setPayload((await res.json()) as BoardPayload);
      return res.ok;
    } catch {
      return false;
    }
  }, [address]);

  const scheduleRefetch = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void refetch(), 250);
  }, [refetch]);

  // One channel per generation; a new generation replaces it after an error.
  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (disposed) return;
      channel = supabase
        .channel(`board:${challengeId}:${generation}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'challenge_activity', filter: `challenge_id=eq.${challengeId}` }, () => scheduleRefetch())
        .subscribe((status) => {
          if (!disposed && STATUS_EVENTS.has(status)) dispatch({ type: status } as LiveEvent);
        });
    })();

    return () => {
      disposed = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [challengeId, generation, scheduleRefetch]);

  // Resubscribe with backoff while reconnecting.
  useEffect(() => {
    if (live.status !== 'reconnecting') return;
    const t = setTimeout(() => setGeneration((g) => g + 1), retryDelayMs(live.attempt));
    return () => clearTimeout(t);
  }, [live.status, live.attempt]);

  // Back after a disconnect: fetch whatever changed meanwhile.
  useEffect(() => {
    if (live.status !== 'live' || !live.missedChanges) return;
    void refetch().then((ok) => ok && dispatch({ type: 'CAUGHT_UP' }));
  }, [live.status, live.missedChanges, refetch]);

  // Browser connectivity and tab visibility.
  useEffect(() => {
    const offline = () => dispatch({ type: 'OFFLINE' });
    const online = () => dispatch({ type: 'ONLINE' });
    const visible = () => document.visibilityState === 'visible' && scheduleRefetch();
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [scheduleRefetch]);

  return { payload, live, refetch };
}

/** Unix seconds, ticking once a second (starts from the server's time to keep hydration identical). */
export function useNowSecs(initial: number): number {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
