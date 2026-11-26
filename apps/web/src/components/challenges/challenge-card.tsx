import { challengeStatus, survivalRate, type ChallengeStatus } from '@codestreak/shared';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { lengthLabel, money, percent, relativeTime, type Token } from './format';

/** A row of the challenge_overview view (only the fields the card uses). */
export interface OverviewRow {
  id: string;
  title: string;
  visibility: 'public' | 'private';
  token: Token;
  onchain_address: string | null;
  buy_in: unknown;
  start_at: string;
  join_deadline_at: string;
  end_at: string;
  num_days: number;
  day_length_secs: number;
  max_participants: number;
  is_demo: boolean;
  pool_state: 'open' | 'cancelled' | 'settled';
  participant_count: number;
  min_participants: number;
  pool_total: unknown;
  members: number;
  still_in: number;
  survived: number;
  finalized: number;
}

export const STATUS_LABEL: Record<ChallengeStatus, { label: string; variant: 'primary' | 'accent' | 'success' | 'default' | 'danger' }> = {
  joining: { label: 'Joining open', variant: 'primary' },
  starting: { label: 'Starting soon', variant: 'accent' },
  running: { label: 'Running', variant: 'success' },
  finished: { label: 'Finished', variant: 'default' },
  cancelled: { label: 'Cancelled', variant: 'danger' },
};

type BadgeVariant = 'primary' | 'accent' | 'success' | 'default' | 'danger' | 'warning';

/**
 * The badge for a challenge, honest about money: "Finished" only once it is settled. A challenge
 * whose days are over but whose results/payouts aren't recorded yet is "Results pending"; one that
 * closed joining without enough players is "Too few players" (its stakes are refundable, not lost).
 */
export function statusBadge(status: ChallengeStatus, row: { pool_state: OverviewRow['pool_state']; participant_count: number; min_participants: number }): { label: string; variant: BadgeVariant } {
  if (row.pool_state === 'cancelled') return STATUS_LABEL.cancelled;
  if (row.pool_state === 'settled') return { label: 'Settled', variant: 'default' };
  if (status !== 'joining' && row.participant_count < row.min_participants) return { label: 'Too few players', variant: 'danger' };
  if (status === 'finished') return { label: 'Results pending', variant: 'warning' };
  return STATUS_LABEL[status];
}

export function statusOf(row: OverviewRow, now: Date): ChallengeStatus {
  return challengeStatus(
    { poolState: row.pool_state, joinDeadlineMs: Date.parse(row.join_deadline_at), startMs: Date.parse(row.start_at), endMs: Date.parse(row.end_at) },
    now.getTime(),
  );
}

const STATUS_TONE: Record<BadgeVariant, { bar: string; fill: string }> = {
  primary: { bar: 'bg-primary', fill: 'bg-primary' },
  accent: { bar: 'bg-accent', fill: 'bg-accent' },
  success: { bar: 'bg-success', fill: 'bg-success' },
  warning: { bar: 'bg-warning', fill: 'bg-warning' },
  danger: { bar: 'bg-destructive', fill: 'bg-destructive/70' },
  default: { bar: 'bg-muted-foreground/30', fill: 'bg-muted-foreground/50' },
};

export function ChallengeCard({ row, now }: { row: OverviewRow; now: Date }) {
  const status = statusOf(row, now);
  const rate = survivalRate({ members: row.members, stillIn: row.still_in, survived: row.survived, finalized: row.finalized });
  const when =
    status === 'joining' ? `Joining closes ${relativeTime(new Date(row.join_deadline_at), now)}` :
    status === 'starting' ? `Starts ${relativeTime(new Date(row.start_at), now)}` :
    status === 'running' ? `Ends ${relativeTime(new Date(row.end_at), now)}` :
    status === 'cancelled' ? 'Cancelled: every stake can be claimed back in full' :
    `Ended ${relativeTime(new Date(row.end_at), now)}`;

  const badge = statusBadge(status, row);
  const showRate = !(status === 'cancelled' || status === 'joining' || status === 'starting');
  const fill = row.max_participants > 0 ? Math.min(100, Math.round((row.participant_count / row.max_participants) * 100)) : 0;
  const tone = STATUS_TONE[badge.variant];

  const body = (
    <Card className="group relative h-full gap-0 overflow-hidden py-0 transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-cobalt-400/60 hover:shadow-[0_8px_30px_-12px] hover:shadow-cobalt-400/30">
      {/* Status stripe: a glanceable colour for the state of the challenge. */}
      <div aria-hidden className={`h-1 w-full ${tone.bar}`} />
      <CardHeader className="space-y-2 pt-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant={badge.variant}>{badge.label}</Badge>
            {row.is_demo && <Badge variant="warning">DEMO</Badge>}
            {row.visibility === 'private' && <Badge variant="accent">Private</Badge>}
          </div>
          <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-muted-foreground">{row.token}</span>
        </div>
        <CardTitle className="line-clamp-2 text-lg">{row.title}</CardTitle>
        <p className="text-xs text-muted-foreground">{when}</p>
      </CardHeader>
      <CardContent className="space-y-4 pb-4">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pool</p>
            <p className="truncate font-mono text-2xl font-semibold tabular-nums">{money(row.pool_total, row.token)}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Buy-in</p>
            <p className="font-mono text-sm tabular-nums">{money(row.buy_in, row.token)}</p>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Players</span>
            <span className="tabular-nums">
              {row.participant_count} / {row.max_participants}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="presentation">
            <div className={`h-full rounded-full ${tone.fill}`} style={{ width: `${fill}%` }} />
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
          <span>
            {lengthLabel(row.num_days, row.day_length_secs)}
            {showRate && (
              <>
                {' · '}
                <span className="text-foreground">{percent(rate)}</span> surviving
              </>
            )}
          </span>
          {row.onchain_address && (
            <span className="text-foreground/70 transition-transform group-hover:translate-x-0.5" aria-hidden>
              View →
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
  return row.onchain_address ? (
    <Link href={`/challenges/${row.onchain_address}`} className="block rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
      {body}
    </Link>
  ) : (
    body
  );
}
