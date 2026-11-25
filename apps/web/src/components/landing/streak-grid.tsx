import { cn } from '@/lib/utils';

type Day = { date: string; verified: number; failed: number };

const LEVELS = ['bg-muted', 'bg-electric-400/30', 'bg-electric-400/55', 'bg-electric-400/80', 'bg-electric-400'];

/** 0 = nothing verified; 1–4 = share of the busiest day (so the scale always fits the real data). */
function level(v: number, max: number): number {
  if (v <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((v / max) * 4)));
}

/**
 * Phase 40 hero: every day of the last 12 weeks, columns = weeks, filled from the day results
 * recorded on-chain (all players together; no names). Cells fade in one after another; the app's
 * Reduced-motion setting and the OS setting turn that off (see .streak-cell in globals.css).
 */
export function StreakGrid({ days }: { days: Day[] }) {
  const max = Math.max(0, ...days.map((d) => d.verified));
  const total = days.reduce((n, d) => n + d.verified, 0);
  const weeks: Day[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return (
    <figure className="space-y-3">
      <div className="flex gap-1" role="img" aria-label={`${total} coding days verified on-chain in the last 12 weeks`}>
        {weeks.map((week, w) => (
          <div key={w} className="flex flex-col gap-1">
            {week.map((d, i) => (
              <span
                key={d.date}
                title={`${d.date}: ${d.verified} verified${d.failed ? `, ${d.failed} missed` : ''}`}
                className={cn('streak-cell block size-3.5 rounded-[3px] sm:size-4', LEVELS[level(d.verified, max)], d.verified === 0 && d.failed > 0 && 'ring-1 ring-danger-400/50 ring-inset')}
                style={{ animationDelay: `${(w * 7 + i) * 12}ms` }}
              />
            ))}
          </div>
        ))}
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{total ? `${total} coding days verified on-chain · last 12 weeks · all players` : 'No days recorded on-chain in the last 12 weeks yet.'}</span>
        <span className="flex items-center gap-1" aria-hidden>
          Less
          {LEVELS.map((c) => (
            <span key={c} className={cn('inline-block size-2.5 rounded-[2px]', c)} />
          ))}
          More
        </span>
      </figcaption>
    </figure>
  );
}
