'use client';

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const PALETTE = ['#a3e635', '#60a5fa', '#f87171', '#fbbf24', '#c084fc', '#94a3b8'];

/** Small daily chart: `bars` are stacked, `lines` drawn on top. Real rows only (no smoothing of gaps). */
export function TimeseriesChart({ data, bars = [], lines = [], height = 220 }: { data: Record<string, string | number>[]; bars?: { key: string; label: string }[]; lines?: { key: string; label: string }[]; height?: number }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #334155)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--color-muted-foreground, #9ca3af)' }} tickFormatter={(d: string) => String(d).slice(5)} interval={4} tickLine={false} axisLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--color-muted-foreground, #9ca3af)' }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ background: 'var(--color-popover, #0f172a)', border: '1px solid var(--color-border, #334155)', borderRadius: 8, fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {bars.map((b, i) => (
            <Bar key={b.key} dataKey={b.key} name={b.label} stackId="s" fill={PALETTE[i % PALETTE.length]} />
          ))}
          {lines.map((l, i) => (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={PALETTE[(i + bars.length) % PALETTE.length]} strokeWidth={2} dot={false} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
