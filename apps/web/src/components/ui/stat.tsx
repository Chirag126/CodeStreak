import type * as React from 'react';
import { cn } from '@/lib/utils';

/** KPI tile: label, a large tabular value, optional hint and icon. */
export function Stat({ label, value, hint, icon, tone = 'default', className }: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: 'default' | 'primary' | 'accent';
  className?: string;
}) {
  return (
    <div data-slot="stat" className={cn('flex flex-col gap-2 rounded-xl border border-border bg-card p-4', className)}>
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        {icon && <span className={cn('[&>svg]:size-4', tone === 'primary' && 'text-primary', tone === 'accent' && 'text-link')}>{icon}</span>}
      </div>
      <div className={cn('text-2xl font-semibold tracking-tight tabular-nums', tone === 'primary' && 'text-electric-300', tone === 'accent' && 'text-cobalt-300')}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
