'use client';

import { useState, useTransition } from 'react';
import { saveVoiceSettingsAction } from '@/app/admin/actions';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

// Phase 41.2 - owner switches for the voice companion. "Voice" is the global kill switch: off means
// no ElevenLabs calls at all (players get the browser's own voice). Saved through one audited call.

export interface VoiceSettingsView {
  enabled: boolean;
  announcements: boolean;
  monthly_char_limit: number;
  user_daily_limit: number;
}

const input = 'h-9 w-36 rounded-md border border-input bg-transparent px-3 text-sm tabular-nums outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

export function VoiceControls({ initial }: { initial: VoiceSettingsView }) {
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const dirty = JSON.stringify(s) !== JSON.stringify(initial);

  const save = () =>
    start(async () => {
      const res = await saveVoiceSettingsAction({ enabled: s.enabled, announcements: s.announcements, monthlyCharLimit: s.monthly_char_limit, userDailyLimit: s.user_daily_limit });
      setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
    });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
          <span>
            <span className="block font-medium">Voice (kill switch)</span>
            <span className="text-xs text-muted-foreground">Off: no ElevenLabs calls; browsers read aloud instead.</span>
          </span>
          <Switch checked={s.enabled} onCheckedChange={(v) => setS({ ...s, enabled: v })} aria-label="Voice enabled" />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
          <span>
            <span className="block font-medium">Spoken announcements</span>
            <span className="text-xs text-muted-foreground">The listen button on notifications.</span>
          </span>
          <Switch checked={s.announcements} onCheckedChange={(v) => setS({ ...s, announcements: v })} aria-label="Announcements enabled" />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
          <span>
            <span className="block font-medium">Monthly character limit</span>
            <span className="text-xs text-muted-foreground">New audio only; cached replays are free.</span>
          </span>
          <input className={input} type="number" min={0} max={10_000_000} step={1000} value={s.monthly_char_limit} onChange={(e) => setS({ ...s, monthly_char_limit: Math.trunc(Number(e.target.value)) })} />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
          <span>
            <span className="block font-medium">New clips per player per day</span>
            <span className="text-xs text-muted-foreground">Stops one account from using the budget.</span>
          </span>
          <input className={input} type="number" min={0} max={1000} value={s.user_daily_limit} onChange={(e) => setS({ ...s, user_daily_limit: Math.trunc(Number(e.target.value)) })} />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={save} disabled={!dirty || busy} loading={busy}>
          Save voice settings
        </Button>
        {msg && (
          <p className={msg.ok ? 'text-xs text-success' : 'text-xs text-destructive-text'} role="status">
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}
