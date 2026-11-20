import { cn } from '@/lib/utils';

/** CodeStreak mark: three rising streak bars inside a rounded tile, plus the wordmark. */
export function Logo({ className, withWordmark = true }: { className?: string; withWordmark?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden>
        <rect x="1" y="1" width="30" height="30" rx="8" className="fill-charcoal-850 stroke-charcoal-700" strokeWidth="1.5" />
        <rect x="8" y="17" width="4" height="8" rx="2" className="fill-cobalt-400" />
        <rect x="14" y="12" width="4" height="13" rx="2" className="fill-electric-500" />
        <rect x="20" y="7" width="4" height="18" rx="2" className="fill-electric-400" />
      </svg>
      {withWordmark && <span className="text-[15px] font-semibold tracking-tight">CodeStreak</span>}
    </span>
  );
}
