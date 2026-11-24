'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Phase 35 audio cues, synthesised in the browser with the Web Audio API: no files, no voice, no
// paid service. Off until the user turns them on (browsers only allow sound after a click), and the
// choice is remembered in this browser.

export type Cue = 'warning' | 'success' | 'fail' | 'coin';

const KEY = 'codestreak:sound';
/** Notes (Hz) and step length (s) per cue. */
const CUES: Record<Cue, { notes: number[]; step: number; type: OscillatorType }> = {
  warning: { notes: [880, 660, 880], step: 0.16, type: 'triangle' },
  success: { notes: [523.25, 659.25, 783.99], step: 0.12, type: 'sine' },
  fail: { notes: [392, 311.13], step: 0.22, type: 'sawtooth' },
  coin: { notes: [987.77, 1318.51], step: 0.09, type: 'square' },
};

function readPref(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
}

export function useSound() {
  const [enabled, setEnabled] = useState(false);
  const ctx = useRef<AudioContext | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setEnabled(readPref()), 0);
    return () => clearTimeout(t);
  }, []);

  const context = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx.current ??= new Ctor();
    if (ctx.current.state === 'suspended') void ctx.current.resume();
    return ctx.current;
  }, []);

  const play = useCallback(
    (cue: Cue, force = false) => {
      if (!enabled && !force) return;
      const ac = context();
      if (!ac) return;
      const { notes, step, type } = CUES[cue];
      const t0 = ac.currentTime + 0.02;
      notes.forEach((freq, i) => {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        const start = t0 + i * step;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.12, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + step * 0.95);
        osc.connect(gain).connect(ac.destination);
        osc.start(start);
        osc.stop(start + step);
      });
    },
    [enabled, context],
  );

  const toggle = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    try {
      window.localStorage.setItem(KEY, next ? 'on' : 'off');
    } catch {
      // Storage blocked (private mode): the choice lasts for this page only.
    }
    if (next) play('success', true); // the click unlocks audio, and confirms it works
  }, [enabled, play]);

  return { enabled, toggle, play };
}
