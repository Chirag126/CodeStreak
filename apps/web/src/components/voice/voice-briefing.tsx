'use client';

import { ArrowRight, Headphones, Mic, Pause, Play, RotateCcw, Square, Volume2, VolumeX } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { useVoicePlayer } from './use-voice-player';

// Phase 41.2 - "Get my update": one button, then a compact panel with the briefing text, the next
// step, and audio controls. Read-only: it never changes anything in the account.

interface BriefingResponse {
  briefing: { paragraphs: string[]; text: string; next: { label: string; href: string; urgent: boolean }; facts: { label: string; value: string }[] };
  audio: { ok: true; url: string; cached: boolean } | { ok: false; reason: string; note: string } | null;
}

const TEXT_ONLY_KEY = 'codestreak.voice.textOnly';

function Waveform({ active, className }: { active: boolean; className?: string }) {
  return (
    <span className={cn('voice-wave inline-flex h-4 items-center gap-[3px]', className)} data-active={active} aria-hidden>
      {[0.55, 0.9, 1, 0.75, 0.5].map((h, i) => (
        <span key={i} className="w-[3px] rounded-full bg-current" style={{ height: `${h * 100}%` }} />
      ))}
    </span>
  );
}

export function VoiceBriefing({ className }: { className?: string }) {
  const player = useVoicePlayer();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BriefingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [textOnly, setTextOnly] = useState(false);

  useEffect(() => {
    let saved = false;
    try {
      saved = localStorage.getItem(TEXT_ONLY_KEY) === '1';
    } catch {
      /* not remembered */
    }
    const t = setTimeout(() => setTextOnly(saved), 0);
    return () => clearTimeout(t);
  }, []);

  const toggleTextOnly = () => {
    const next = !textOnly;
    setTextOnly(next);
    if (next) player.stop();
    try {
      localStorage.setItem(TEXT_ONLY_KEY, next ? '1' : '0');
    } catch {
      /* not remembered */
    }
  };

  const getUpdate = useCallback(async () => {
    setLoading(true);
    setError(null);
    player.stop();
    try {
      const res = await fetch('/api/voice/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: !textOnly }),
      });
      const body = (await res.json().catch(() => null)) as (BriefingResponse & { error?: string }) | null;
      if (!res.ok || !body?.briefing) {
        setError(body?.error ?? (res.status === 429 ? 'Too many updates in a minute. Try again shortly.' : "Your update couldn't be loaded. Try again."));
        return;
      }
      setData(body);
      if (!textOnly) {
        // Started by the click on "Get my update"; if the browser still blocks sound, Play starts it.
        if (body.audio?.ok) player.start({ kind: 'clip', url: body.audio.url, text: body.briefing.text });
        else player.start({ kind: 'browser', text: body.briefing.text });
      }
    } catch {
      setError("Couldn't reach CodeStreak. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [player, textOnly]);

  const speaking = player.state === 'playing';
  const audioNote = data?.audio && !data.audio.ok ? data.audio.note : null;

  return (
    <Card className={cn('gap-0 overflow-hidden py-0', className)}>
      <CardContent className="flex flex-wrap items-center gap-3 py-4">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-full ring-1 transition-colors', speaking || loading ? 'bg-primary/15 text-primary ring-primary/40' : 'bg-muted text-muted-foreground ring-border')} aria-hidden>
          {speaking || loading ? <Waveform active /> : <Mic className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Your coding companion</p>
          <p className="text-xs text-muted-foreground">{loading ? 'Putting your update together…' : 'Hear what’s happening, how much time is left and what to do next.'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={toggleTextOnly}
            aria-pressed={textOnly}
            title={textOnly ? 'Text only: on (no audio is generated)' : 'Text only: off'}
            aria-label={textOnly ? 'Text only is on. Turn sound back on' : 'Switch to text only'}
          >
            {textOnly ? <VolumeX /> : <Headphones />}
          </Button>
          <Button onClick={() => void getUpdate()} loading={loading} disabled={loading}>
            <Mic aria-hidden /> Get my update
          </Button>
        </div>
      </CardContent>

      {error && (
        <p className="border-t border-border px-6 py-3 text-sm text-destructive-text" role="alert">
          {error}
        </p>
      )}

      {data && (
        <div className="space-y-4 border-t border-border bg-muted/20 px-6 py-4" aria-live="polite">
          <div className="space-y-2 text-sm leading-relaxed">
            {data.briefing.paragraphs.slice(0, -1).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>

          <Link
            href={data.briefing.next.href}
            className={cn(
              'group flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors',
              data.briefing.next.urgent ? 'border-warning/50 bg-warning/10 hover:bg-warning/15' : 'border-border bg-background hover:bg-muted',
            )}
          >
            <span>
              <span className="mr-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Next</span>
              {data.briefing.next.label}
            </span>
            <ArrowRight className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>

          {data.briefing.facts.length > 0 && (
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
              {data.briefing.facts.map((f) => (
                <div key={f.label} className="flex gap-1.5">
                  <dt>{f.label}</dt>
                  <dd className="font-medium text-foreground tabular-nums">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {!textOnly && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {speaking ? (
                  <Button size="sm" variant="secondary" onClick={player.pause} aria-label="Pause">
                    <Pause aria-hidden /> Pause
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={player.state === 'paused' ? player.resume : player.play} aria-label={player.state === 'paused' ? 'Resume' : 'Play'}>
                    <Play aria-hidden /> {player.state === 'paused' ? 'Resume' : 'Play'}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={player.stop} disabled={player.state === 'idle'} aria-label="Stop">
                  <Square aria-hidden /> Stop
                </Button>
                <Button size="sm" variant="ghost" onClick={player.replay} aria-label="Replay from the start">
                  <RotateCcw aria-hidden /> Replay
                </Button>
                <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                  <Volume2 className="size-4" aria-hidden />
                  <span className="sr-only">Volume</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={player.volume}
                    onChange={(e) => player.setVolume(Number(e.target.value))}
                    className="h-1.5 w-24 cursor-pointer accent-[var(--primary)]"
                    aria-label="Volume"
                  />
                </label>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="h-full rounded-full bg-primary transition-[width] duration-200" style={{ width: `${Math.round(player.progress * 100)}%` }} />
              </div>
              {player.state === 'error' && <p className="text-xs text-destructive-text">Audio couldn&apos;t play on this device. The text above has everything.</p>}
              {audioNote && <p className="text-xs text-muted-foreground">{audioNote}</p>}
              {data.audio?.ok && <p className="text-[11px] text-muted-foreground/70">Voice by ElevenLabs</p>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
