'use client';

import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ToastInput {
  kind: 'success' | 'error' | 'info';
  title: string;
  message?: string;
  href?: string;
  hrefLabel?: string;
}
interface Toast extends ToastInput {
  id: number;
}

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

/** Shows a toast. Errors stay longer and are announced assertively to screen readers. */
export function useToast(): (t: ToastInput) => void {
  const push = useContext(ToastContext);
  if (!push) throw new Error('useToast must be used inside <Toaster>');
  return push;
}

const ICONS = { success: CheckCircle2, error: CircleAlert, info: Info } as const;

export function Toaster({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: ToastInput) => {
      const id = nextId.current++;
      setToasts((all) => [...all.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.kind === 'error' ? 10_000 : 6_000);
    },
    [dismiss],
  );
  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ol className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:w-96" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const Icon = ICONS[t.kind];
            return (
              <motion.li
                key={t.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 40, transition: { duration: 0.15 } }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                role={t.kind === 'error' ? 'alert' : 'status'}
                className={cn(
                  'pointer-events-auto flex w-full gap-3 rounded-lg border bg-card p-4 shadow-lg',
                  t.kind === 'error' ? 'border-destructive/40' : t.kind === 'success' ? 'border-electric-400/30' : 'border-border',
                )}
              >
                <Icon
                  className={cn('mt-0.5 size-5 shrink-0', t.kind === 'error' ? 'text-destructive-text' : t.kind === 'success' ? 'text-success' : 'text-muted-foreground')}
                  aria-hidden
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-medium">{t.title}</p>
                  {t.message && <p className="text-sm text-muted-foreground">{t.message}</p>}
                  {t.href && (
                    <a className="text-sm underline underline-offset-4" href={t.href} target="_blank" rel="noreferrer">
                      {t.hrefLabel ?? 'Open'}
                    </a>
                  )}
                </div>
                <button type="button" onClick={() => dismiss(t.id)} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">
                  <X className="size-4" />
                </button>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </ToastContext.Provider>
  );
}
