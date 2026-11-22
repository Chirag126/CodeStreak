'use client';

import { Check, Loader2, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { TX_STEPS, type TxFlowState } from './tx-flow';

export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

/** Build → sign → confirm progress for one transaction, with the result underneath. */
export function TxStepper({ state }: { state: TxFlowState }) {
  if (state.status === 'idle') return null;
  return (
    <div className="space-y-3 rounded-lg border border-border p-4" aria-live="polite">
      <ol className="flex items-start gap-2">
        {TX_STEPS.map((step, i) => {
          const status = state.steps[step.id];
          return (
            <li key={step.id} className="flex flex-1 items-start gap-2">
              <motion.span
                layout
                className={cn(
                  'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs',
                  status === 'done' && 'border-electric-400/50 bg-electric-400/15 text-success',
                  status === 'active' && 'border-cobalt-400 text-foreground',
                  status === 'error' && 'border-destructive/60 bg-destructive/15 text-destructive-text',
                  status === 'pending' && 'border-border text-muted-foreground',
                )}
                aria-hidden
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span key={status} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }}>
                    {status === 'done' ? <Check className="size-3.5" /> : status === 'error' ? <X className="size-3.5" /> : status === 'active' ? <Loader2 className="size-3.5 animate-spin" /> : i + 1}
                  </motion.span>
                </AnimatePresence>
              </motion.span>
              <div className="min-w-0">
                <p className={cn('text-sm font-medium', status === 'pending' && 'text-muted-foreground')}>{step.label}</p>
                {status === 'active' && <p className="text-xs text-muted-foreground">{step.hint}</p>}
                <span className="sr-only">{status}</span>
              </div>
            </li>
          );
        })}
      </ol>
      {state.status === 'success' && state.signature && (
        <p className="text-sm text-success">
          Confirmed on devnet.{' '}
          <a className="underline underline-offset-4" href={explorerTxUrl(state.signature)} target="_blank" rel="noreferrer">
            View on Explorer
          </a>
        </p>
      )}
      {state.status === 'error' && state.error && (
        <div role="alert" className="space-y-0.5">
          <p className="text-sm font-medium text-destructive-text">{state.error.title}</p>
          <p className="text-sm text-muted-foreground">{state.error.message}</p>
        </div>
      )}
    </div>
  );
}
