'use client';

import type { ActivityPoint } from '@codestreak/shared';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const COLORS = {
  verified: 'var(--color-electric-400, #a3e635)',
  shielded: 'var(--color-cobalt-400, #60a5fa)',
  failed: 'var(--color-danger-400, #f87171)',
  undecided: 'var(--color-warning-400, #fbbf24)',
  commits: 'var(--color-foreground, #e5e7eb)',
  solves: 'var(--color-muted-foreground, #9ca3af)',
};

/** Last 30 UTC days: recorded day results (stacked bars) and counted commits / solves (lines). */
export function ActivityChart({ data }: { data: ActivityPoint[] }) {
  return (
    <div className="h-64 w-full" role="img" aria-label="Your coding activity over the last 30 days">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #334155)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground, #9ca3af)' }} interval={4} tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-muted-foreground, #9ca3af)' }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ background: 'var(--color-popover, #0f172a)', border: '1px solid var(--color-border, #334155)', borderRadius: 8, fontSize: 12 }}
            labelFormatter={(_l, p) => (p?.[0]?.payload as ActivityPoint | undefined)?.date ?? ''}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="verified" name="Verified" stackId="days" fill={COLORS.verified} radius={[0, 0, 0, 0]} />
          <Bar dataKey="shielded" name="Shielded" stackId="days" fill={COLORS.shielded} />
          <Bar dataKey="undecided" name="Undecided" stackId="days" fill={COLORS.undecided} />
          <Bar dataKey="failed" name="Failed" stackId="days" fill={COLORS.failed} radius={[3, 3, 0, 0]} />
          <Line type="monotone" dataKey="commits" name="Commits" stroke={COLORS.commits} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="solves" name="Solves" stroke={COLORS.solves} strokeWidth={2} strokeDasharray="4 3" dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
