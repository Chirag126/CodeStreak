'use client';

import { useEffect, useState } from 'react';

export interface VoiceStatus {
  signedIn: boolean;
  voice?: boolean;
  browser?: boolean;
  announcements?: boolean;
}

// One request per page load, shared by every component that asks.
let pending: Promise<VoiceStatus> | null = null;

export function refreshVoiceStatus(): void {
  pending = null;
}

/** `enabled` = false skips the request (e.g. signed out). */
export function useVoiceStatus(enabled = true): VoiceStatus | null {
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    pending ??= fetch('/api/voice/status', { cache: 'no-store' })
      .then((r) => (r.ok ? (r.json() as Promise<VoiceStatus>) : { signedIn: false }))
      .catch(() => ({ signedIn: false }));
    void pending.then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, [enabled]);
  return status;
}
