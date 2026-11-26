'use client';

import { emptyInbox, inboxReducer, type NotificationItem } from '@codestreak/shared';
import { useCallback, useEffect, useReducer, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const COLUMNS = 'id, kind, title, body, href, created_at, read_at';

/**
 * The signed-in user's notifications, live: loads the newest `limit` and the unread count, then
 * follows Supabase Realtime (inserts and read-state updates; RLS sends each user only their own).
 * After a reconnect or when the tab comes back it reloads, so nothing missed is lost.
 */
export function useInbox(limit = 20) {
  const [state, dispatch] = useReducer(inboxReducer, emptyInbox);
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    const [{ data }, { count }] = await Promise.all([
      supabase.from('notifications').select(COLUMNS).order('created_at', { ascending: false }).limit(limit),
      supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
    ]);
    dispatch({ type: 'reset', items: (data ?? []) as NotificationItem[], unread: count ?? 0 });
    setLoaded(true);
  }, [limit]);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    const supabase = createSupabaseBrowserClient();
    void supabase.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setUserId(session?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) return;
    const supabase = createSupabaseBrowserClient();
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      if (disposed) return;
      await load();
      // Unmounted while loading: don't open a channel nobody will close.
      if (disposed) return;
      let wasDown = false;
      // One channel per hook instance: the bell and the dashboard both use this hook on the same
      // client, and a shared name made the second one add callbacks to an already-subscribed channel.
      channel = supabase
        .channel(`inbox:${userId}:${crypto.randomUUID()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `profile_id=eq.${userId}` }, (payload) => {
          if (payload.eventType === 'DELETE') return;
          dispatch({ type: 'upsert', item: payload.new as NotificationItem });
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED' && wasDown) void load();
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') wasDown = true;
        });
    })();
    const visible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', visible);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId, load]);

  const markRead = useCallback(async (ids: string[] | 'all') => {
    dispatch({ type: 'read', ids, at: new Date().toISOString() });
    await createSupabaseBrowserClient().rpc('mark_notifications_read', { p_ids: ids === 'all' ? null : ids });
  }, []);

  return { ...state, signedIn: userId, loaded, markRead, reload: load };
}
