import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset [&>svg]:size-3 [&>svg]:pointer-events-none',
  {
    variants: {
      variant: {
        default: 'bg-muted text-foreground ring-border',
        primary: 'bg-electric-400/10 text-electric-300 ring-electric-400/25',
        accent: 'bg-cobalt-400/10 text-cobalt-300 ring-cobalt-400/25',
        success: 'bg-electric-400/10 text-success ring-electric-400/25',
        warning: 'bg-warning-400/10 text-warning ring-warning-400/25',
        danger: 'bg-danger-400/10 text-destructive-text ring-danger-400/25',
        outline: 'bg-transparent text-muted-foreground ring-input',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
