'use client';

import { useState, useTransition } from 'react';
import { DayLogView } from '@/components/checks/day-log';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { dayLogAction } from '@/app/challenges/[address]/check-actions';
import type { DayLog } from '@/lib/verification/day-check';

/** Opens a member's latest check for a day (loaded on open; the database decides visibility). */
export function ViewChecks({ membershipId, name, day }: { membershipId: string; name: string; day: number }) {
  const [log, setLog] = useState<DayLog | null | undefined>(undefined);
  const [busy, start] = useTransition();
  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) start(async () => setLog(await dayLogAction(membershipId, day)));
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          View checks
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {name}: day {day + 1}
          </DialogTitle>
          <DialogDescription>What GitHub showed at the latest check, and why each commit did or didn&apos;t count.</DialogDescription>
        </DialogHeader>
        {busy || log === undefined ? <p className="text-sm text-muted-foreground">Loading…</p> : log ? <DayLogView log={log} /> : <p className="text-sm text-muted-foreground">No check to show (not checked yet, or the member keeps details private).</p>}
      </DialogContent>
    </Dialog>
  );
}
