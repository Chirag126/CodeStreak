import { NextResponse, type NextRequest } from 'next/server';
import { overLimit, tooManyRequests, VOICE } from '@/lib/http/rate-limit';
import { nowSecs } from '@/lib/insights/load';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';
import { loadBriefing } from '@/lib/voice/briefing';
import { FALLBACK_NOTE } from '@/lib/voice/policy';
import { loadPrefs } from '@/lib/voice/prefs';
import { speak } from '@/lib/voice/service';

// Phase 41.2 - "Get my update". Read-only: builds the briefing from the player's own data and,
// when they want to listen, a clip of it. Never changes anything except the voice usage log.

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: NextRequest) {
  const wait = overLimit(req, VOICE);
  if (wait) return tooManyRequests(wait);
  const viewer = await getViewer();
  if (!viewer) return json({ error: 'Sign in to get your update.' }, 401);

  let wantAudio = true;
  try {
    const body = (await req.json()) as { audio?: unknown };
    wantAudio = body?.audio !== false;
  } catch {
    /* empty body: default to audio */
  }

  const supabase = await createSupabaseServerClient();
  let briefing;
  try {
    briefing = await loadBriefing(supabase, viewer.userId, nowSecs());
  } catch {
    return json({ error: "Your update couldn't be loaded right now. Try again in a moment." }, 503);
  }

  if (!wantAudio) return json({ briefing, audio: null });
  const prefs = await loadPrefs(supabase, viewer.userId);
  if (!prefs.voice) return json({ briefing, audio: { ok: false, reason: 'muted', note: FALLBACK_NOTE.muted } });
  const audio = await speak({ profileId: viewer.userId, kind: 'briefing', text: briefing.text });
  return json({ briefing, audio });
}
