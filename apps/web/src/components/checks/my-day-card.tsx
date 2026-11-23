'use client';

import { formatWait } from '@codestreak/shared';
import { useState, useTransition } from 'react';
import { useToast } from '@/components/feedback/toaster';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { checkMyDayAction } from '@/app/challenges/[address]/check-actions';
import { useCountdown } from '@/app/sign-in/use-countdown';
import type { DayLog } from '@/lib/verification/day-check';
import { DayLogView } from './day-log';

/** A player's own day: check GitHub now and see exactly what counted and why. */
export function MyDayCard({ address, day, initial }: { address: string; day: number; initial: DayLog | null }) {
  const toast = useToast();
  const [log, setLog] = useState<DayLog | null>(initial);
  const [busy, start] = useTransition();
  const [retryAt, setRetryAt] = useState<number | undefined>(undefined);
  const wait = useCountdown(retryAt);

  function check() {
    start(async () => {
      const r = await checkMyDayAction(address);
      if (!r.ok) {
        if (r.retryAfterSecs) setRetryAt(Date.now() + r.retryAfterSecs * 1000);
        toast({ kind: 'error', title: 'Not checked', message: r.error });
        return;
      }
      if (r.log) setLog(r.log);
      setRetryAt(Date.now() + 60_000);
      toast({ kind: r.log?.outcome === 'met' ? 'success' : 'info', title: r.log?.outcome === 'met' ? 'Goal reached for today' : 'Checked', message: r.log ? `${r.log.lines} of ${r.log.goal} meaningful lines so far.` : undefined });
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle>Your day {day + 1}</CardTitle>
          <Button className="ml-auto" onClick={check} loading={busy} disabled={wait > 0}>
            {wait > 0 ? `Check again in ${formatWait(wait)}` : log ? 'Check again' : 'Check now'}
          </Button>
        </div>
        <CardDescription>Reads your pushes on GitHub for today and shows what counts. Push, then check.</CardDescription>
      </CardHeader>
      <CardContent>{log ? <DayLogView log={log} /> : <p className="text-sm text-muted-foreground">Not checked yet today.</p>}</CardContent>
    </Card>
  );
}
