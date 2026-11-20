import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Loading placeholder with a soft shimmer (static when motion is reduced). */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        'animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--color-charcoal-800)_0%,var(--color-charcoal-700)_50%,var(--color-charcoal-800)_100%)] bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  );
}
