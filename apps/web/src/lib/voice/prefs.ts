import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export interface NotificationPrefs {
  deadlines: boolean;
  results: boolean;
  rewards: boolean;
  group_updates: boolean;
  voice: boolean;
  browser: boolean;
}

/** Everything on except browser pop-ups (those need the player's explicit permission). */
export const DEFAULT_PREFS: NotificationPrefs = { deadlines: true, results: true, rewards: true, group_updates: true, voice: true, browser: false };

/** The signed-in player's preferences (RLS: own row only); defaults when never saved. */
export async function loadPrefs(supabase: SupabaseClient, profileId: string): Promise<NotificationPrefs> {
  const { data } = await supabase.from('notification_prefs').select('deadlines, results, rewards, group_updates, voice, browser').eq('profile_id', profileId).maybeSingle();
  return data ? { ...DEFAULT_PREFS, ...(data as Partial<NotificationPrefs>) } : DEFAULT_PREFS;
}
