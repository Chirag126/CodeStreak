'use client';

import { Progress as ProgressPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Progress({ className, value, indicatorClassName, ...props }: React.ComponentProps<typeof ProgressPrimitive.Root> & { indicatorClassName?: string }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <ProgressPrimitive.Root data-slot="progress" value={value} className={cn('relative h-2 w-full overflow-hidden rounded-full bg-charcoal-800', className)} {...props}>
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn('h-full w-full flex-1 rounded-full bg-primary transition-transform duration-500 ease-out-expo', indicatorClassName)}
        style={{ transform: `translateX(-${100 - pct}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
