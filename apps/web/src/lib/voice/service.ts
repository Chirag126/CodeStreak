import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { voiceConfig } from './config';
import { ElevenLabsError, synthesize } from './eleven';
import { clipHash, clipPath, FALLBACK_NOTE, type FallbackReason, type VoiceKind } from './policy';

// Phase 41.2 - turns text into a playable clip, spending ElevenLabs credits only when needed:
//   1. kill switches (Control Center) and the player's own voice setting,
//   2. the cache: identical text in the same voice/model is generated once, ever,
//   3. app-side limits (monthly characters, new clips per player per day), checked and counted
//      atomically in the database before the call,
//   4. ElevenLabs; the audio goes to the private `voice` bucket; the browser gets a signed link.
// Anything that stops at 1-4 returns a fallback reason: the browser's own voice reads the text,
// so the feature never breaks. This module never touches wallets, claims or transactions.

const BUCKET = 'voice';
const LINK_SECS = 15 * 60;

export type SpeakResult = { ok: true; url: string; cached: boolean } | { ok: false; reason: FallbackReason; note: string };

const fallback = (reason: FallbackReason): SpeakResult => ({ ok: false, reason, note: FALLBACK_NOTE[reason] });

interface VoiceSettings {
  enabled: boolean;
  announcements: boolean;
}

export async function voiceSettings(): Promise<VoiceSettings> {
  const { data, error } = await createSupabaseAdminClient().rpc('voice_settings_get');
  if (error || !data) return { enabled: false, announcements: false };
  const s = data as Partial<VoiceSettings>;
  return { enabled: s.enabled === true, announcements: s.announcements === true };
}

async function log(profileId: string, kind: VoiceKind, outcome: string, chars: number, latencyMs: number | null, error: string | null) {
  await createSupabaseAdminClient().rpc('voice_log', { p_profile: profileId, p_kind: kind, p_outcome: outcome, p_chars: chars, p_latency_ms: latencyMs, p_error: error });
}

/** Removes clips nobody played for 30 days (storage + index). Runs now and then after a generation. */
async function pruneOldClips() {
  const admin = createSupabaseAdminClient();
  const { data } = await admin.from('voice_clips').select('hash, path').lt('last_used_at', new Date(Date.now() - 30 * 86_400_000).toISOString()).limit(100);
  if (!data?.length) return;
  await admin.storage.from(BUCKET).remove(data.map((c) => c.path as string));
  await admin.from('voice_clips').delete().in('hash', data.map((c) => c.hash as string));
}

export async function speak(input: { profileId: string; kind: VoiceKind; text: string }): Promise<SpeakResult> {
  const text = input.text.trim();
  if (!text) return fallback('error');
  const cfg = voiceConfig();
  const settings = await voiceSettings();
  if (!settings.enabled) {
    await log(input.profileId, input.kind, 'fallback_disabled', text.length, null, null);
    return fallback('disabled');
  }
  if (input.kind === 'announcement' && !settings.announcements) {
    await log(input.profileId, input.kind, 'fallback_disabled', text.length, null, null);
    return fallback('announcements_off');
  }

  const admin = createSupabaseAdminClient();
  const hash = clipHash(cfg.voiceId, cfg.modelId, text);
  const path = clipPath(hash);

  // 2. Cache.
  const started = Date.now();
  const { data: hit } = await admin.from('voice_clips').select('path, plays').eq('hash', hash).maybeSingle();
  if (hit) {
    const { data: link } = await admin.storage.from(BUCKET).createSignedUrl(hit.path as string, LINK_SECS);
    if (link?.signedUrl) {
      await admin.from('voice_clips').update({ last_used_at: new Date().toISOString(), plays: (hit.plays as number) + 1 }).eq('hash', hash);
      await log(input.profileId, input.kind, 'cached', text.length, Date.now() - started, null);
      return { ok: true, url: link.signedUrl, cached: true };
    }
    // The file is gone (pruned by hand?): forget it and generate again.
    await admin.from('voice_clips').delete().eq('hash', hash);
  }

  if (!cfg.apiKey) {
    await log(input.profileId, input.kind, 'fallback_unconfigured', text.length, null, cfg.keyProblem);
    return fallback('unconfigured');
  }

  // 3. Limits, counted before the call.
  const { data: reservation, error: reserveError } = await admin.rpc('voice_reserve', { p_profile: input.profileId, p_kind: input.kind, p_chars: text.length });
  if (reserveError) return fallback('error');
  const r = reservation as { ok: boolean; reason?: string; event?: number };
  if (!r.ok) {
    await log(input.profileId, input.kind, r.reason === 'disabled' ? 'fallback_disabled' : 'fallback_limit', text.length, null, r.reason ?? null);
    return fallback(r.reason === 'monthly_limit' ? 'monthly_limit' : r.reason === 'daily_limit' ? 'daily_limit' : 'disabled');
  }

  // 4. Generate, store, link.
  const t0 = Date.now();
  try {
    const audio = await synthesize(cfg, text);
    const { error: upErr } = await admin.storage.from(BUCKET).upload(path, audio, { contentType: 'audio/mpeg', upsert: true, cacheControl: '31536000' });
    if (upErr) throw new ElevenLabsError(`storing the audio failed: ${upErr.message}`, null);
    await admin.from('voice_clips').upsert({ hash, path, chars: text.length, voice_id: cfg.voiceId, model_id: cfg.modelId, last_used_at: new Date().toISOString(), plays: 1 });
    const { data: link } = await admin.storage.from(BUCKET).createSignedUrl(path, LINK_SECS);
    if (!link?.signedUrl) throw new ElevenLabsError('could not create a link to the audio', null);
    await admin.rpc('voice_finish', { p_event: r.event, p_ok: true, p_latency_ms: Date.now() - t0, p_error: null });
    if (Math.random() < 0.05) void pruneOldClips().catch(() => undefined);
    return { ok: true, url: link.signedUrl, cached: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    await admin.rpc('voice_finish', { p_event: r.event, p_ok: false, p_latency_ms: Date.now() - t0, p_error: message });
    return fallback('error');
  }
}
