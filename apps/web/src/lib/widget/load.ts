import 'server-only';

import { usernameFromPath, widgetModel, type WidgetModel } from '@codestreak/shared';
import { nowSecs } from '@/lib/insights/load';
import { loadPublicProfile } from '@/lib/profile/load';

/**
 * The widget data for a username. Uses the public profile loader, so the same rules apply: hidden,
 * banned and deleted accounts look exactly like unknown ones, and private groups are numbers only.
 * `ok: false` = the lookup itself failed (show the placeholder, but don't cache it).
 */
export async function loadWidget(rawUsername: string): Promise<{ model: WidgetModel; ok: boolean }> {
  const username = usernameFromPath(rawUsername);
  if (!username) return { model: { found: false }, ok: true };
  try {
    return { model: widgetModel(await loadPublicProfile(username, nowSecs())), ok: true };
  } catch (e) {
    console.error('[widget] profile load failed:', e instanceof Error ? e.message : e);
    return { model: { found: false }, ok: false };
  }
}

/** Cache: real cards for 10 minutes (served stale for a day while refreshing), placeholders briefly. */
export function widgetCache(model: WidgetModel, ok: boolean): string {
  if (!ok) return 'no-store';
  return model.found ? 'public, max-age=600, s-maxage=600, stale-while-revalidate=86400' : 'public, max-age=60, s-maxage=60';
}
