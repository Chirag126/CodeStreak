import { NextResponse, type NextRequest } from 'next/server';
import { overLimit, tooManyRequests, VOICE } from '@/lib/http/rate-limit';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';
import { announcementText, FALLBACK_NOTE } from '@/lib/voice/policy';
import { loadPrefs } from '@/lib/voice/prefs';
import { speak } from '@/lib/voice/service';

// Phase 41.2 - a spoken version of one of the player's own notifications, on request only (never
// autoplayed). Identical notifications share one cached clip across players.

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: NextRequest) {
  const wait = overLimit(req, VOICE);
  if (wait) return tooManyRequests(wait);
  const viewer = await getViewer();
  if (!viewer) return json({ error: 'Sign in first.' }, 401);
  let id: unknown;
  try {
    id = ((await req.json()) as { notificationId?: unknown })?.notificationId;
  } catch {
    /* handled below */
  }
  if (typeof id !== 'string' || !UUID.test(id)) return json({ error: 'Malformed request.' }, 400);

  const supabase = await createSupabaseServerClient();
  // RLS: only the player's own notifications are readable.
  const { data: n } = await supabase.from('notifications').select('title, body').eq('id', id).maybeSingle();
  if (!n) return json({ error: 'Notification not found.' }, 404);
  const text = announcementText({ title: n.title as string, body: (n.body as string) ?? '' });

  const prefs = await loadPrefs(supabase, viewer.userId);
  if (!prefs.voice) return json({ text, audio: { ok: false, reason: 'muted', note: FALLBACK_NOTE.muted } });
  const audio = await speak({ profileId: viewer.userId, kind: 'announcement', text });
  return json({ text, audio });
}
