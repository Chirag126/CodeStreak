'use client';

import { Switch as SwitchPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-input bg-charcoal-800 p-0.5 transition-colors outline-none',
        'focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-[18px] rounded-full bg-charcoal-100 shadow-sm transition-transform duration-200 ease-out-expo data-[state=checked]:translate-x-5 data-[state=checked]:bg-primary-foreground"
      />
    </SwitchPrimitive.Root>
  );
}
