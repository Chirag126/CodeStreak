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

export function ChallengeCard({ row, now }: { row: OverviewRow; now: Date }) {
  const status = statusOf(row, now);
  const rate = survivalRate({ members: row.members, stillIn: row.still_in, survived: row.survived, finalized: row.finalized });
  const when =
    status === 'joining' ? `Joining closes ${relativeTime(new Date(row.join_deadline_at), now)}` :
    status === 'starting' ? `Starts ${relativeTime(new Date(row.start_at), now)}` :
    status === 'running' ? `Ends ${relativeTime(new Date(row.end_at), now)}` :
    status === 'cancelled' ? 'Cancelled: every stake can be claimed back in full' :
    `Ended ${relativeTime(new Date(row.end_at), now)}`;

  const body = (
    <Card className="h-full transition-colors hover:border-cobalt-400/60">
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={statusBadge(status, row).variant}>{statusBadge(status, row).label}</Badge>
          {row.is_demo && <Badge variant="warning">DEMO</Badge>}
          {row.visibility === 'private' && <Badge variant="accent">Private</Badge>}
        </div>
        <CardTitle className="line-clamp-2 text-lg">{row.title}</CardTitle>
        <p className="text-xs text-muted-foreground">{when}</p>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Buy-in</dt>
          <dd className="text-right font-mono">{money(row.buy_in, row.token)}</dd>
          <dt className="text-muted-foreground">Pool</dt>
          <dd className="text-right font-mono">{money(row.pool_total, row.token)}</dd>
          <dt className="text-muted-foreground">Players</dt>
          <dd className="text-right">
            {row.participant_count} / {row.max_participants}
          </dd>
          <dt className="text-muted-foreground">Surviving</dt>
          <dd className="text-right">{status === 'cancelled' || status === 'joining' || status === 'starting' ? '–' : percent(rate)}</dd>
          <dt className="text-muted-foreground">Length</dt>
          <dd className="text-right">{lengthLabel(row.num_days, row.day_length_secs)}</dd>
        </dl>
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
