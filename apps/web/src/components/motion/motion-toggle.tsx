'use client';

import { cn } from '@/lib/utils';
import { useMotionPreference, type MotionPreference } from './motion-preference';

const OPTIONS: { value: MotionPreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'reduce', label: 'Reduced' },
  { value: 'full', label: 'Full' },
];

/** Segmented control for the animation preference. */
export function MotionToggle({ className }: { className?: string }) {
  const { preference, setPreference, reduce } = useMotionPreference();
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span id="motion-toggle-label" className="text-xs text-muted-foreground">
        Animations
      </span>
      <div role="radiogroup" aria-labelledby="motion-toggle-label" className="inline-flex rounded-md border border-border bg-card p-0.5">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={preference === o.value}
            onClick={() => setPreference(o.value)}
            className={cn(
              'rounded-[5px] px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60',
              preference === o.value && 'bg-muted text-foreground',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <span className="sr-only" aria-live="polite">
        {reduce ? 'Animations reduced' : 'Animations on'}
      </span>
    </div>
  );
}
