'use client';

import { Square, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useVoicePlayer } from './use-voice-player';
import { useVoiceStatus } from './use-voice-status';

// Phase 41.2 - "hear this" on a notification. Only on click; hidden when the player turned voice
// off or the owner switched announcements off. Same text = same cached clip for everyone.

export function SpeakButton({ notificationId, className }: { notificationId: string; className?: string }) {
  const status = useVoiceStatus();
  const player = useVoicePlayer();
  const [busy, setBusy] = useState(false);
  if (!status?.signedIn || !status.voice || !status.announcements) return null;

  const active = busy || player.state === 'playing';
  const onClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (active) {
      player.stop();
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/voice/announce', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notificationId }) });
      const body = (await res.json().catch(() => null)) as { text?: string; audio?: { ok: boolean; url?: string } } | null;
      if (!res.ok || !body?.text) return;
      if (body.audio?.ok && body.audio.url) player.start({ kind: 'clip', url: body.audio.url, text: body.text });
      else player.start({ kind: 'browser', text: body.text });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={(e) => void onClick(e)}
      className={cn('grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none', active && 'text-primary', className)}
      aria-label={active ? 'Stop reading this notification' : 'Read this notification aloud'}
      title={active ? 'Stop' : 'Listen'}
    >
      {active ? <Square className="size-3.5" aria-hidden /> : <Volume2 className="size-3.5" aria-hidden />}
    </button>
  );
}
