// Phase 41.2 - pure helpers for the voice service (unit-tested; no server imports).
import { createHash } from 'node:crypto';
import { speakable } from '@codestreak/shared';

export type VoiceKind = 'briefing' | 'announcement';

/** Cache key: the same words in the same voice and model always map to the same clip. */
export function clipHash(voiceId: string, modelId: string, text: string): string {
  return createHash('sha256').update(`${voiceId}\u0000${modelId}\u0000${text}`).digest('hex');
}

/** Storage path for a clip: fanned out by the first hash byte. */
export function clipPath(hash: string): string {
  return `clips/${hash.slice(0, 2)}/${hash}.mp3`;
}

/** What a notification sounds like: its title and body, cleaned and short. */
export function announcementText(n: { title: string; body: string }): string {
  const title = speakable(n.title, 140).replace(/\s*[·•]\s*/g, ', ');
  const body = speakable(n.body, 220);
  const t = /[.!?…]$/.test(title) ? title : `${title}.`;
  return body ? `${t} ${body}` : t;
}

export type FallbackReason = 'disabled' | 'announcements_off' | 'unconfigured' | 'monthly_limit' | 'daily_limit' | 'error' | 'muted';

/** What the player is told when the browser's own voice is used instead. */
export const FALLBACK_NOTE: Record<FallbackReason, string> = {
  disabled: 'The CodeStreak voice is switched off right now, so your browser is reading this.',
  announcements_off: 'Spoken announcements are switched off right now, so your browser is reading this.',
  unconfigured: 'The CodeStreak voice is not set up on this server, so your browser is reading this.',
  monthly_limit: 'The CodeStreak voice has used its budget for this month, so your browser is reading this.',
  daily_limit: "You've reached today's limit for new spoken updates, so your browser is reading this. Replays of earlier ones still work.",
  error: "The CodeStreak voice couldn't be reached, so your browser is reading this.",
  muted: 'Voice is off in your notification settings.',
};
