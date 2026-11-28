import { NextResponse } from 'next/server';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';
import { loadPrefs } from '@/lib/voice/prefs';
import { voiceSettings } from '@/lib/voice/service';

// Phase 41.2 - what the browser needs to show voice / pop-up options (no secrets, no usage figures).
export const dynamic = 'force-dynamic';

export async function GET() {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ signedIn: false }, { headers: { 'Cache-Control': 'no-store' } });
  const [prefs, settings] = await Promise.all([loadPrefs(await createSupabaseServerClient(), viewer.userId), voiceSettings()]);
  return NextResponse.json(
    { signedIn: true, voice: prefs.voice, browser: prefs.browser, announcements: settings.enabled && settings.announcements },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
