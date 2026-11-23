import { combineDay, CONFIDENCE, VERDICT_REASON_TEXT, type ProviderRule, type RuleProvider } from '@codestreak/shared';
import { Badge } from '@/components/ui/badge';
import type { DayLog } from '@/lib/verification/day-check';
import { cn } from '@/lib/utils';

const OUTCOME = {
  met: { label: 'Goal reached', variant: 'success' },
  not_met: { label: 'Not yet', variant: 'warning' },
  unknown: { label: "Couldn't be fully checked", variant: 'default' },
} as const;
const NAME = { github: 'GitHub', leetcode: 'LeetCode' } as const;

/** A day check for one provider, readable by anyone allowed to see it: progress, explanations, then every item. */
export function DayLogView({ log, preview = true }: { log: DayLog; preview?: boolean }) {
  const pct = Math.min(100, Math.round((log.lines / Math.max(1, log.goal)) * 100));
  const github = log.provider === 'github';
  const time = new Date(log.checkedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {NAME[log.provider]} · day {log.day + 1}: {log.lines} of {log.goal} {log.unit}
          </span>
          <Badge variant={OUTCOME[log.outcome].variant}>{OUTCOME[log.outcome].label}</Badge>
          {preview && <span className="text-xs text-muted-foreground">Preview: the final result is recorded after the day ends.</span>}
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={log.goal} aria-valuenow={log.lines}>
          <div className={cn('h-full rounded-full transition-[width] duration-500', log.outcome === 'met' ? 'bg-electric-400' : 'bg-cobalt-400')} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          {github ? `${log.pushes} push${log.pushes === 1 ? '' : 'es'} found` : `${log.pushes} profile snapshot${log.pushes === 1 ? '' : 's'} today`} · checked {time} UTC
        </p>
      </div>

      {log.hints.length > 0 && (
        <ul className="list-disc space-y-1 pl-5">
          {log.hints.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}

      {log.commits.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">{github ? 'Commit' : 'Problem'}</th>
                {github && <th className="py-1 pr-3 font-medium">Repository</th>}
                {github && <th className="py-1 pr-3 font-medium">Lines</th>}
                <th className="py-1 font-medium">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {log.commits.map((c) => (
                <tr key={c.id} className={c.counted ? '' : 'text-muted-foreground'}>
                  <td className={cn('py-1.5 pr-3', github && 'font-mono')}>
                    <a className="underline underline-offset-2" href={c.url} target="_blank" rel="noreferrer">
                      {c.label} ↗
                    </a>
                  </td>
                  {github && <td className="py-1.5 pr-3">{c.context}</td>}
                  {github && <td className="py-1.5 pr-3">{c.value}</td>}
                  <td className="py-1.5">{c.counted && !github ? `✓ ${c.reason}` : c.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {log.notes.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {log.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Every provider's log for a day, one after another. */
export function DayLogsView({ logs, preview = true }: { logs: DayLog[]; preview?: boolean }) {
  return (
    <div className="space-y-6">
      {logs.map((l) => (
        <DayLogView key={l.provider} log={l} preview={preview} />
      ))}
    </div>
  );
}

const VERDICT = {
  verified: { label: 'Verified', variant: 'success' },
  failed: { label: 'Failed', variant: 'warning' },
  indeterminate: { label: "Can't be decided", variant: 'default' },
} as const;

/**
 * What the rules engine would decide if the day ended at the last check: the providers combined
 * under the challenge's ANY/ALL rule, gated by confidence (the same code builds the final receipt).
 */
export function DayVerdictView({ logs, rule, providers, dayEndsAt }: { logs: DayLog[]; rule: ProviderRule; providers: RuleProvider[]; dayEndsAt?: number }) {
  const scored = providers.map((p) => {
    const l = logs.find((x) => x.provider === p);
    return { provider: p, outcome: l?.engineOutcome ?? ('unknown' as const), confidence: l?.confidence ?? 0 };
  });
  const v = combineDay(rule, scored);
  // While the day still runs (at the last check), a shortfall isn't a failure yet: say "not done yet".
  const checkedAt = Math.max(0, ...logs.map((l) => Date.parse(l.checkedAt) / 1000));
  const running = dayEndsAt !== undefined && checkedAt < dayEndsAt;
  const shown = running && v.verdict === 'failed' ? { label: 'Not done yet', variant: 'warning' as const } : VERDICT[v.verdict];
  return (
    <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">{running ? 'So far today:' : 'Day result at this check:'}</span>
        <Badge variant={shown.variant}>{shown.label}</Badge>
        <span className="text-xs text-muted-foreground">confidence {v.confidence}%</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {running && v.verdict === 'failed' ? 'If the day ended now, it would fail. ' : VERDICT_REASON_TEXT[v.reason] + ' '}
        {providers.length > 1 && (rule === 'all' ? 'This challenge needs every provider.' : 'This challenge needs any one provider.')} A day fails only at
        confidence {CONFIDENCE.failMin}%+ and is verified at {CONFIDENCE.verifyMin}%+.
      </p>
    </div>
  );
}
