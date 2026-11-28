import 'server-only';

// Phase 41.2 - ElevenLabs configuration. Server-only: the key never leaves the web service.
// One fixed voice for everyone, changeable by the developer through environment variables.

/** Sarah (ElevenLabs premade): warm, clear, professional; available to every account. */
export const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL';
/** Flash v2.5: natural, low latency, and half the credits of Multilingual v2. */
export const DEFAULT_MODEL_ID = 'eleven_flash_v2_5';
/** 64 kbps MP3: plenty for speech, small to store and fast to load on phones. */
export const OUTPUT_FORMAT = 'mp3_44100_64';

export interface VoiceConfig {
  apiKey: string | null;
  voiceId: string;
  modelId: string;
  /** Why the key is unusable (malformed), for the Control Center. */
  keyProblem: string | null;
}

export function voiceConfig(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
  const raw = env.ELEVENLABS_API_KEY?.trim() ?? '';
  const keyOk = /^sk_[A-Za-z0-9]{32,}$/.test(raw);
  const voice = env.ELEVENLABS_VOICE_ID?.trim() ?? '';
  const model = env.ELEVENLABS_MODEL_ID?.trim() ?? '';
  return {
    apiKey: keyOk ? raw : null,
    voiceId: /^[A-Za-z0-9]{16,40}$/.test(voice) ? voice : DEFAULT_VOICE_ID,
    modelId: /^[a-z0-9_]{3,64}$/.test(model) ? model : DEFAULT_MODEL_ID,
    keyProblem: raw && !keyOk ? 'ELEVENLABS_API_KEY is set but is not an ElevenLabs key (sk_…)' : null,
  };
}
