import { Badge } from '@/components/ui/badge';
import type { DayLog } from '@/lib/verification/day-check';
import { cn } from '@/lib/utils';

const OUTCOME = {
  met: { label: 'Goal reached', variant: 'success' },
  not_met: { label: 'Not yet', variant: 'warning' },
  unknown: { label: "Couldn't be fully checked", variant: 'default' },
} as const;

/** A day check, readable by anyone allowed to see it: progress, explanations, then every commit. */
export function DayLogView({ log, preview = true }: { log: DayLog; preview?: boolean }) {
  const pct = Math.min(100, Math.round((log.lines / log.goal) * 100));
  return (
    <div className="space-y-4 text-sm">
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            Day {log.day + 1}: {log.lines} of {log.goal} meaningful lines
          </span>
          <Badge variant={OUTCOME[log.outcome].variant}>{OUTCOME[log.outcome].label}</Badge>
          {preview && <span className="text-xs text-muted-foreground">Preview: the final result is recorded after the day ends.</span>}
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={log.goal} aria-valuenow={log.lines}>
          <div className={cn('h-full rounded-full transition-[width] duration-500', log.outcome === 'met' ? 'bg-electric-400' : 'bg-cobalt-400')} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          {log.pushes} push{log.pushes === 1 ? '' : 'es'} found · checked {new Date(log.checkedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC
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
                <th className="py-1 pr-3 font-medium">Commit</th>
                <th className="py-1 pr-3 font-medium">Repository</th>
                <th className="py-1 pr-3 font-medium">Lines</th>
                <th className="py-1 font-medium">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {log.commits.map((c) => (
                <tr key={c.sha} className={c.counted ? '' : 'text-muted-foreground'}>
                  <td className="py-1.5 pr-3 font-mono">
                    <a className="underline underline-offset-2" href={`https://github.com/${c.repo}/commit/${c.sha}`} target="_blank" rel="noreferrer">
                      {c.sha.slice(0, 8)} ↗
                    </a>
                  </td>
                  <td className="py-1.5 pr-3">{c.repo}</td>
                  <td className="py-1.5 pr-3">{c.counted ? c.lines : '–'}</td>
                  <td className="py-1.5">{c.reason}</td>
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
