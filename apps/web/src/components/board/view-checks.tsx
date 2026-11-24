'use client';

import { useState, useTransition } from 'react';
import { DayLogsView } from '@/components/checks/day-log';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { dayLogAction } from '@/app/challenges/[address]/check-actions';
import type { DayLog } from '@/lib/verification/day-check';

type State = { kind: 'idle' } | { kind: 'ok'; log: DayLog[] } | { kind: 'error' };

/** Opens a member's latest check for a day (loaded on open; the database decides visibility). */
export function ViewChecks({ membershipId, name, day }: { membershipId: string; name: string; day: number }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [busy, start] = useTransition();
  // Never leave the dialog on "Loading…": a failed or slow request ends in an error with a retry.
  const load = () =>
    start(async () => {
      try {
        const log = await Promise.race([
          dayLogAction(membershipId, day),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15_000)),
        ]);
        setState({ kind: 'ok', log });
      } catch {
        setState({ kind: 'error' });
      }
    });

  return (
    <Dialog onOpenChange={(open) => open && load()}>
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
          <DialogDescription>What GitHub and LeetCode showed at the latest check, and why each item did or didn&apos;t count.</DialogDescription>
        </DialogHeader>
        {busy || state.kind === 'idle' ? (
          <p className="text-sm text-muted-foreground" role="status">
            Loading…
          </p>
        ) : state.kind === 'error' ? (
          <div className="space-y-2 text-sm">
            <p className="text-destructive-text">Couldn&apos;t load this check right now (the server or Solana devnet may be busy).</p>
            <Button size="sm" variant="outline" onClick={load}>
              Try again
            </Button>
          </div>
        ) : state.log.length ? (
          <DayLogsView logs={state.log} />
        ) : (
          <p className="text-sm text-muted-foreground">No check to show (not checked yet, or the member keeps details private).</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
