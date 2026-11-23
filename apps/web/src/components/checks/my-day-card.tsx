'use client';

import { formatWait } from '@codestreak/shared';
import { useState, useTransition } from 'react';
import { useToast } from '@/components/feedback/toaster';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { checkMyDayAction } from '@/app/challenges/[address]/check-actions';
import { useCountdown } from '@/app/sign-in/use-countdown';
import type { DayLog } from '@/lib/verification/day-check';
import type { ProviderRule, RuleProvider } from '@codestreak/shared';
import { DayLogsView, DayVerdictView } from './day-log';

/** A player's own day: check every provider now and see exactly what counted and why. */
export function MyDayCard({
  address,
  day,
  dayEndsAt,
  initial,
  rule,
  providers,
}: {
  address: string;
  day: number;
  /** Unix seconds: the verdict is worded as a preview until then. */
  dayEndsAt: number;
  initial: DayLog[];
  rule: ProviderRule;
  providers: RuleProvider[];
}) {
  const toast = useToast();
  const [logs, setLogs] = useState<DayLog[]>(initial);
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
      const next = r.logs ?? [];
      if (next.length) setLogs(next);
      setRetryAt(Date.now() + 60_000);
      const allMet = next.length > 0 && next.every((l) => l.outcome === 'met');
      toast({ kind: allMet ? 'success' : 'info', title: allMet ? 'Goal reached for today' : 'Checked', message: next.map((l) => `${l.provider === 'github' ? 'GitHub' : 'LeetCode'}: ${l.lines} of ${l.goal} ${l.unit}`).join(' · ') || undefined });
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle>Your day {day + 1}</CardTitle>
          <Button className="ml-auto" onClick={check} loading={busy} disabled={wait > 0}>
            {wait > 0 ? `Check again in ${formatWait(wait)}` : logs.length ? 'Check again' : 'Check now'}
          </Button>
        </div>
        <CardDescription>Reads today’s GitHub pushes and/or LeetCode profile (whatever this challenge counts) and shows what counts. Push or solve, then check.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {logs.length > 0 && <DayVerdictView logs={logs} rule={rule} providers={providers} dayEndsAt={dayEndsAt} />}
        {logs.length ? <DayLogsView logs={logs} /> : <p className="text-sm text-muted-foreground">Not checked yet today.</p>}
      </CardContent>
    </Card>
  );
}
