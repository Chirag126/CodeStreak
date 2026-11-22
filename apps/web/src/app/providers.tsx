'use client';

import type { ReactNode } from 'react';
import { AuthFragmentForwarder } from '@/components/auth/auth-fragment-forwarder';
import { Toaster } from '@/components/feedback/toaster';
import { MotionPreferenceProvider } from '@/components/motion/motion-preference';
import { TooltipProvider } from '@/components/ui/tooltip';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <MotionPreferenceProvider>
      <TooltipProvider>
        <Toaster>
          <AuthFragmentForwarder />
          {children}
        </Toaster>
      </TooltipProvider>
    </MotionPreferenceProvider>
  );
}
