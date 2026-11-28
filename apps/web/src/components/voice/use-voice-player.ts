'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Phase 41.2 - one small audio player for the voice companion. Plays an ElevenLabs clip (signed
// link) or, as a fallback, reads the text with the browser's own speech synthesis. Never starts
// by itself: every play() comes from a click. Volume is remembered on this device.

export type PlayerState = 'idle' | 'playing' | 'paused' | 'ended' | 'error';
export type PlayerSource = { kind: 'clip'; url: string; text: string } | { kind: 'browser'; text: string };

const VOLUME_KEY = 'codestreak.voice.volume';

function readVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && v >= 0 && v <= 1 && localStorage.getItem(VOLUME_KEY) !== null ? v : 0.9;
  } catch {
    return 0.9;
  }
}

export function browserSpeechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function useVoicePlayer() {
  const [state, setState] = useState<PlayerState>('idle');
  const [volume, setVolumeState] = useState(0.9);
  const [progress, setProgress] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const source = useRef<PlayerSource | null>(null);
  const volumeRef = useRef(0.9);

  useEffect(() => {
    const v = readVolume();
    volumeRef.current = v;
    const t = setTimeout(() => setVolumeState(v), 0);
    return () => clearTimeout(t);
  }, []);

  const stopAll = useCallback(() => {
    if (audio.current) {
      audio.current.pause();
      audio.current.src = '';
      audio.current = null;
    }
    if (browserSpeechAvailable()) window.speechSynthesis.cancel();
  }, []);

  // Stop on unmount (leaving the page shouldn't leave a voice talking).
  useEffect(() => stopAll, [stopAll]);

  const start = useCallback(
    (src: PlayerSource) => {
      stopAll();
      source.current = src;
      setProgress(0);

      const speakWithBrowser = (text: string) => {
        if (!browserSpeechAvailable()) {
          setState('error');
          return;
        }
        const u = new SpeechSynthesisUtterance(text);
        u.volume = volumeRef.current;
        u.rate = 1;
        u.lang = 'en-US';
        u.onstart = () => setState('playing');
        u.onend = () => {
          setProgress(1);
          setState('ended');
        };
        u.onerror = (e) => setState(e.error === 'interrupted' || e.error === 'canceled' ? 'idle' : 'error');
        u.onboundary = (e) => setProgress(Math.min(1, e.charIndex / Math.max(1, text.length)));
        window.speechSynthesis.speak(u);
        setState('playing');
      };

      if (src.kind === 'browser') {
        speakWithBrowser(src.text);
        return;
      }
      const a = new Audio(src.url);
      a.volume = volumeRef.current;
      a.onplay = () => setState('playing');
      a.onpause = () => setState((s) => (s === 'playing' ? 'paused' : s));
      a.onended = () => {
        setProgress(1);
        setState('ended');
      };
      a.ontimeupdate = () => {
        if (a.duration) setProgress(a.currentTime / a.duration);
      };
      a.onerror = () => {
        // The clip failed to load (expired link, network): read the same text instead.
        audio.current = null;
        speakWithBrowser(src.text);
      };
      audio.current = a;
      // Some browsers only allow sound straight after a click; if this play wasn't, wait for Play.
      a.play().catch((e: unknown) => setState(e instanceof DOMException && e.name === 'NotAllowedError' ? 'idle' : 'error'));
    },
    [stopAll],
  );

  const pause = useCallback(() => {
    if (audio.current) audio.current.pause();
    else if (browserSpeechAvailable()) {
      window.speechSynthesis.pause();
      setState('paused');
    }
  }, []);

  const resume = useCallback(() => {
    if (audio.current) void audio.current.play().catch(() => setState('error'));
    else if (browserSpeechAvailable()) {
      window.speechSynthesis.resume();
      setState('playing');
    }
  }, []);

  const stop = useCallback(() => {
    stopAll();
    // Keep the source so Play / Replay can start it again.
    setProgress(0);
    setState('idle');
  }, [stopAll]);

  const replay = useCallback(() => {
    if (source.current) start(source.current);
  }, [start]);

  /** Play button: continue a loaded clip, or start the current source again. */
  const play = useCallback(() => {
    if (audio.current) void audio.current.play().catch(() => setState('error'));
    else if (source.current) start(source.current);
  }, [start]);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    volumeRef.current = clamped;
    setVolumeState(clamped);
    if (audio.current) audio.current.volume = clamped;
    try {
      localStorage.setItem(VOLUME_KEY, String(clamped));
    } catch {
      /* private mode: not remembered */
    }
  }, []);

  return { state, progress, volume, setVolume, start, play, pause, resume, stop, replay };
}
