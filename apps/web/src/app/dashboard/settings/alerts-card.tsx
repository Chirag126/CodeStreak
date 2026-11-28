'use client';

import { useEffect, useState, useTransition } from 'react';
import { refreshVoiceStatus } from '@/components/voice/use-voice-status';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import type { NotificationPrefs } from '@/lib/voice/prefs';
import { saveNotificationPrefsAction, saveTimezoneAction } from './actions';

// Phase 41.2 - what CodeStreak tells you about, and how. In-app notifications are the main channel;
// voice is on request only; browser pop-ups are optional and need the browser's permission.

const ROWS: { key: keyof NotificationPrefs; title: string; body: string }[] = [
  { key: 'deadlines', title: 'Deadline alerts', body: 'Before a day ends while it isn’t verified yet, plus a last call near the end.' },
  { key: 'results', title: 'Day results and disputes', body: 'When a day is verified or missed, and updates on disputes you opened.' },
  { key: 'rewards', title: 'Rewards and results', body: 'Challenge finished, payouts ready or paid, badges earned.' },
  { key: 'group_updates', title: 'Group updates', body: 'Invitations, players joining your challenge and sponsorships.' },
  { key: 'voice', title: 'Voice', body: '“Get my update” reads aloud, and notifications get a listen button. Nothing ever plays by itself.' },
  { key: 'browser', title: 'Browser pop-ups', body: 'Show new notifications as pop-ups while CodeStreak is open in a background tab.' },
];

export function AlertsCard({ prefs, timezone }: { prefs: NotificationPrefs; timezone: string }) {
  const [values, setValues] = useState(prefs);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [browserTz, setBrowserTz] = useState<string | null>(null);
  const [savedTz, setSavedTz] = useState(timezone);

  useEffect(() => {
    let tz: string | null = null;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    } catch {
      tz = null;
    }
    const t = setTimeout(() => setBrowserTz(tz), 0);
    return () => clearTimeout(t);
  }, []);

  const save = (key: keyof NotificationPrefs, value: boolean) => {
    const before = values[key];
    setValues((v) => ({ ...v, [key]: value }));
    setMessage(null);
    start(async () => {
      const res = await saveNotificationPrefsAction({ [key]: value });
      if (!res.ok) {
        setValues((v) => ({ ...v, [key]: before }));
        setMessage({ ok: false, text: res.error });
        return;
      }
      refreshVoiceStatus();
      setMessage({ ok: true, text: 'Saved.' });
    });
  };

  const toggle = async (key: keyof NotificationPrefs, value: boolean) => {
    if (key === 'browser' && value) {
      if (typeof Notification === 'undefined') {
        setMessage({ ok: false, text: 'This browser doesn’t support notification pop-ups.' });
        return;
      }
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (permission !== 'granted') {
        setMessage({ ok: false, text: 'Pop-ups are blocked for this site. Allow notifications in the browser’s site settings, then try again.' });
        return;
      }
    }
    save(key, value);
  };

  const applyBrowserTz = () => {
    if (!browserTz) return;
    start(async () => {
      const res = await saveTimezoneAction(browserTz);
      if (res.ok) setSavedTz(browserTz);
      setMessage(res.ok ? { ok: true, text: `Deadline alerts now show times in ${browserTz}.` } : { ok: false, text: res.error });
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alerts and voice</CardTitle>
        <CardDescription>What CodeStreak tells you about. Account notices (like a suspension) are always shown.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        <ul className="divide-y divide-border">
          {ROWS.map((r) => (
            <li key={r.key} className="flex items-start justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium">{r.title}</p>
                <p className="text-xs text-muted-foreground">{r.body}</p>
              </div>
              <Switch checked={values[r.key]} onCheckedChange={(v) => void toggle(r.key, v)} disabled={pending} aria-label={r.title} />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-sm">
          <p className="text-muted-foreground">
            Time zone for alerts: <span className="font-medium text-foreground">{savedTz}</span>
          </p>
          {browserTz && browserTz !== savedTz && (
            <Button size="sm" variant="secondary" onClick={applyBrowserTz} loading={pending}>
              Use {browserTz}
            </Button>
          )}
        </div>
        {message && (
          <p className={message.ok ? 'pt-1 text-xs text-success' : 'pt-1 text-xs text-destructive-text'} role="status">
            {message.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
