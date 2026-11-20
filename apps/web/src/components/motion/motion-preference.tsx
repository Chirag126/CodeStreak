'use client';

// Reduced-motion preference: "system" follows the OS setting; "reduce" / "full" override it.
// Applies to Motion components (MotionConfig) AND to CSS animations/transitions (html[data-motion]).
import { MotionConfig } from 'motion/react';
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';

export type MotionPreference = 'system' | 'reduce' | 'full';

const STORAGE_KEY = 'codestreak:motion';
const QUERY = '(prefers-reduced-motion: reduce)';

// ---- preference store (localStorage, shared across tabs) ----
const listeners = new Set<() => void>();

function readPreference(): MotionPreference {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'reduce' || v === 'full' ? v : 'system';
  } catch {
    return 'system';
  }
}

function writePreference(pref: MotionPreference): void {
  try {
    if (pref === 'system') window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts for this page only.
  }
  memoryPref = pref;
  listeners.forEach((l) => l());
}

let memoryPref: MotionPreference | null = null;

function subscribePreference(callback: () => void): () => void {
  listeners.add(callback);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) {
      memoryPref = null;
      callback();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(callback);
    window.removeEventListener('storage', onStorage);
  };
}

const getPreference = (): MotionPreference => memoryPref ?? readPreference();
const getServerPreference = (): MotionPreference => 'system';

// ---- OS setting store ----
function subscribeSystem(callback: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}
const getSystem = (): boolean => window.matchMedia(QUERY).matches;
const getServerSystem = (): boolean => false;

interface MotionPreferenceValue {
  preference: MotionPreference;
  setPreference: (pref: MotionPreference) => void;
  /** True when motion should be reduced right now (user choice or OS setting). */
  reduce: boolean;
}

const MotionPreferenceContext = createContext<MotionPreferenceValue | null>(null);

export function MotionPreferenceProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(subscribePreference, getPreference, getServerPreference);
  const systemReduce = useSyncExternalStore(subscribeSystem, getSystem, getServerSystem);
  const reduce = preference === 'reduce' || (preference === 'system' && systemReduce);

  useEffect(() => {
    const root = document.documentElement;
    if (preference === 'system') delete root.dataset.motion;
    else root.dataset.motion = preference;
  }, [preference]);

  const setPreference = useCallback((pref: MotionPreference) => writePreference(pref), []);
  const value = useMemo(() => ({ preference, setPreference, reduce }), [preference, setPreference, reduce]);
  const policy = preference === 'system' ? 'user' : preference === 'reduce' ? 'always' : 'never';

  return (
    <MotionPreferenceContext.Provider value={value}>
      <MotionConfig reducedMotion={policy}>{children}</MotionConfig>
    </MotionPreferenceContext.Provider>
  );
}

export function useMotionPreference(): MotionPreferenceValue {
  const ctx = useContext(MotionPreferenceContext);
  if (!ctx) throw new Error('useMotionPreference must be used inside MotionPreferenceProvider');
  return ctx;
}
