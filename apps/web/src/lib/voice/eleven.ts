import 'server-only';

import { OUTPUT_FORMAT, type VoiceConfig } from './config';

// The two ElevenLabs calls CodeStreak makes: text to speech, and the account's real usage
// (GET /v1/user/subscription) for the Control Center. Nothing else is sent: only the briefing or
// notification text (already stripped of links, addresses and emails).

const API = 'https://api.elevenlabs.io/v1';

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

/** Plain-language reason for a failed call, safe to log (never includes the key or the text). */
function describe(status: number, body: string): string {
  let detail = '';
  try {
    const j = JSON.parse(body) as { detail?: { status?: string; message?: string } | string };
    detail = typeof j.detail === 'string' ? j.detail : (j.detail?.message ?? j.detail?.status ?? '');
  } catch {
    /* not JSON */
  }
  const what =
    status === 401 ? 'the API key was rejected' : status === 402 || /quota|credits/i.test(detail) ? 'the ElevenLabs plan is out of credits' : status === 429 ? 'ElevenLabs is rate limiting requests' : status >= 500 ? 'ElevenLabs is unavailable' : `ElevenLabs refused the request (${status})`;
  return `${what}${detail ? `: ${detail.slice(0, 160)}` : ''}`;
}

export async function synthesize(cfg: VoiceConfig, text: string, timeoutMs = 20_000): Promise<Uint8Array> {
  if (!cfg.apiKey) throw new ElevenLabsError('ElevenLabs is not configured', null);
  let res: Response;
  try {
    res = await fetch(`${API}/text-to-speech/${encodeURIComponent(cfg.voiceId)}?output_format=${OUTPUT_FORMAT}`, {
      method: 'POST',
      headers: { 'xi-api-key': cfg.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: cfg.modelId,
        // Calm and clear rather than theatrical.
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true },
        apply_text_normalization: 'auto',
      }),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
  } catch (e) {
    throw new ElevenLabsError(e instanceof Error && e.name === 'TimeoutError' ? 'ElevenLabs did not answer in time' : 'could not reach ElevenLabs', null);
  }
  if (!res.ok) throw new ElevenLabsError(describe(res.status, await res.text().catch(() => '')), res.status);
  const audio = new Uint8Array(await res.arrayBuffer());
  if (audio.byteLength < 200) throw new ElevenLabsError('ElevenLabs returned empty audio', res.status);
  return audio;
}

export interface AccountUsage {
  tier: string;
  used: number;
  limit: number;
  resetsAt: number | null;
}

/** The account's real usage as ElevenLabs reports it, or null when the key can't read it. */
export async function accountUsage(cfg: VoiceConfig): Promise<AccountUsage | { error: string } | null> {
  if (!cfg.apiKey) return null;
  try {
    const res = await fetch(`${API}/user/subscription`, { headers: { 'xi-api-key': cfg.apiKey }, signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!res.ok) return { error: res.status === 401 ? 'This key can make speech but not read the account. To see real usage here, edit the key in ElevenLabs (Developers → API Keys) and set User to Read.' : describe(res.status, await res.text().catch(() => '')) };
    const j = (await res.json()) as { tier?: string; character_count?: number; character_limit?: number; next_character_count_reset_unix?: number | null };
    if (typeof j.character_count !== 'number' || typeof j.character_limit !== 'number') return { error: 'ElevenLabs returned no usage figures.' };
    return { tier: String(j.tier ?? 'unknown'), used: j.character_count, limit: j.character_limit, resetsAt: j.next_character_count_reset_unix ?? null };
  } catch {
    return { error: 'Could not reach ElevenLabs.' };
  }
}
