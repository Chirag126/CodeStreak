import type * as React from 'react';
import { cn } from '@/lib/utils';

export type KpiTone = 'primary' | 'accent' | 'success' | 'warning' | 'muted';

const TONES: Record<KpiTone, { chip: string; glow: string }> = {
  primary: { chip: 'bg-primary/10 text-primary ring-primary/25', glow: 'bg-primary' },
  accent: { chip: 'bg-cobalt-400/10 text-cobalt-300 ring-cobalt-400/25', glow: 'bg-cobalt-400' },
  success: { chip: 'bg-success/10 text-success ring-success/25', glow: 'bg-success' },
  warning: { chip: 'bg-warning/10 text-warning ring-warning/25', glow: 'bg-warning' },
  muted: { chip: 'bg-muted text-muted-foreground ring-border', glow: 'bg-muted-foreground' },
};

/**
 * Stat tile for the dashboard and public profiles: label, a large value, a hint, and a coloured icon
 * chip with a soft glow so a row of tiles reads at a glance. Pure markup (works in server components).
 */
export function KpiTile({ label, value, hint, icon, tone = 'muted', className }: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: KpiTone;
  className?: string;
}) {
  const t = TONES[tone];
  return (
    <div
      data-slot="kpi"
      className={cn(
        'relative h-full overflow-hidden rounded-xl border border-border bg-card p-4 text-card-foreground transition-colors hover:border-border/80 sm:p-5',
        className,
      )}
    >
      <div aria-hidden className={cn('pointer-events-none absolute -top-10 -right-10 size-28 rounded-full opacity-[0.12] blur-2xl', t.glow)} />
      <div className="relative flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {icon && <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg ring-1 [&>svg]:size-3.5', t.chip)}>{icon}</span>}
      </div>
      <p className="relative mt-1 text-2xl font-semibold tracking-tight tabular-nums break-words">{value}</p>
      {hint && <p className="relative mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
