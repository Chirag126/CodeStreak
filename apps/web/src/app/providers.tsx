'use client';

import type { ReactNode } from 'react';
import { MotionPreferenceProvider } from '@/components/motion/motion-preference';
import { TooltipProvider } from '@/components/ui/tooltip';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <MotionPreferenceProvider>
      <TooltipProvider>{children}</TooltipProvider>
    </MotionPreferenceProvider>
  );
}
