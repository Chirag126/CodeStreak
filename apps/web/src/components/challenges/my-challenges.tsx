import { challengeStatus, formatAmount, SOL_DECIMALS, USDC_DECIMALS } from '@codestreak/shared';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { statusBadge } from './challenge-card';

export interface MyChallenge {
  address: string;
  title: string;
  role: 'Creator' | 'Player' | 'Creator & player';
  badge: ReturnType<typeof statusBadge>;
  active: boolean;
  isDemo: boolean;
  isPrivate: boolean;
  /** "3 × 10 min · 23 Nov" */
  meta: string;
  /** Where it sits in "Your challenges". */
  group: 'active' | 'finished' | 'cancelled';
  /** The viewer's own result, in words, and how to colour it. */
  outcome: { label: string; variant: 'success' | 'danger' | 'warning' | 'outline' | 'primary' | 'accent' };
  /** "0.05 SOL → 0.14 SOL" for players, or the buy-in for creators who didn't play. */
  money: string;
  /** "+0.09 SOL" / "−0.05 SOL" / "" (only once the result is final). */
  net: string;
  netPositive: boolean | null;
}

const utcDay = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Challenges the person created or plays in: active ones first, then the rest, newest first. */
export async function listMyChallenges(profileId: string): Promise<MyChallenge[]> {
  const admin = createSupabaseAdminClient();
  const [{ data: memberships }, { data: created }] = await Promise.all([
    admin.from('memberships').select('challenge_id, status, deposited, payout').eq('profile_id', profileId).limit(200),
    admin.from('challenges').select('id').eq('creator_id', profileId).limit(200),
  ]);
  const playing = new Set((memberships ?? []).map((m) => m.challenge_id as string));
  const membership = new Map((memberships ?? []).map((m) => [m.challenge_id as string, m]));
  const mine = new Set((created ?? []).map((c) => c.id as string));
  const ids = [...new Set([...playing, ...mine])];
  if (ids.length === 0) return [];
  const { data: rows } = await admin
    .from('challenges')
    .select('id, title, onchain_address, pool_state, visibility, is_demo, token, buy_in, join_deadline_at, start_at, day_length_secs, num_days, participant_count, min_participants')
    .in('id', ids)
    .not('onchain_address', 'is', null)
    .order('start_at', { ascending: false })
    .limit(50);
  const now = Date.now();
  return (rows ?? [])
    .map((r): MyChallenge => {
      const startMs = Date.parse(r.start_at as string);
      const status = challengeStatus(
        {
          poolState: r.pool_state as 'open' | 'cancelled' | 'settled',
          joinDeadlineMs: Date.parse(r.join_deadline_at as string),
          startMs,
          endMs: startMs + (r.num_days as number) * (r.day_length_secs as number) * 1000,
        },
        now,
      );
      const badge = statusBadge(status, {
        pool_state: r.pool_state as 'open' | 'cancelled' | 'settled',
        participant_count: r.participant_count as number,
        min_participants: r.min_participants as number,
      });
      const id = r.id as string;
      const sol = r.token === 'sol';
      const decimals = sol ? SOL_DECIMALS : USDC_DECIMALS;
      const unit = sol ? 'SOL' : 'USDC';
      const amt = (v: bigint) => `${formatAmount(v, decimals)} ${unit}`;
      const dayLen = r.day_length_secs as number;
      const length = dayLen >= 86400 ? `${r.num_days} days` : `${r.num_days} × ${Math.round(dayLen / 60)} min`;
      const pool = r.pool_state as 'open' | 'cancelled' | 'settled';
      const active = pool === 'open' && (status === 'joining' || status === 'starting' || status === 'running') && badge.label !== 'Too few players';
      const group: MyChallenge['group'] = pool === 'cancelled' ? 'cancelled' : active ? 'active' : 'finished';
      const m = membership.get(id);
      let outcome: MyChallenge['outcome'];
      let money = `Buy-in ${amt(BigInt(String(r.buy_in)))}`;
      let net = '';
      let netPositive: boolean | null = null;
      if (m) {
        const stake = BigInt(String(m.deposited));
        const paid = m.payout === null || m.payout === undefined ? null : BigInt(String(m.payout));
        money = paid === null ? `Stake ${amt(stake)}` : `${amt(stake)} → ${amt(paid)}`;
        if (pool === 'cancelled') {
          outcome = paid === null ? { label: 'Refund on its way', variant: 'warning' } : { label: 'Refunded', variant: 'outline' };
        } else if (m.status === 'survived') {
          outcome = { label: paid === null ? 'Survived · payout on its way' : 'Survived', variant: 'success' };
        } else if (m.status === 'failed') {
          outcome = { label: 'Failed', variant: 'danger' };
          money = `Stake ${amt(stake)} forfeited`;
          net = `−${amt(stake)}`;
          netPositive = false;
        } else if (m.status === 'voided') {
          outcome = { label: paid === null ? 'Voided · refund on its way' : 'Voided · refunded', variant: 'warning' };
        } else {
          outcome = active ? { label: status === 'running' ? 'Playing' : 'Joined', variant: 'primary' } : { label: 'Awaiting settlement', variant: 'accent' };
        }
        if (paid !== null) {
          const d = paid - stake;
          net = d === 0n ? '±0' : `${d > 0n ? '+' : '−'}${amt(d > 0n ? d : -d)}`;
          netPositive = d > 0n ? true : d < 0n ? false : null;
        }
      } else {
        // Created it without playing.
        outcome =
          pool === 'cancelled'
            ? { label: Number(r.participant_count) === 0 ? 'Cancelled · nobody joined' : 'Cancelled · everyone refunded', variant: 'outline' }
            : { label: active ? badge.label : 'Ended', variant: active ? 'primary' : 'outline' };
      }
      return {
        address: r.onchain_address as string,
        title: r.title as string,
        role: mine.has(id) && playing.has(id) ? 'Creator & player' : mine.has(id) ? 'Creator' : 'Player',
        badge,
        active,
        group,
        outcome,
        money,
        net,
        netPositive,
        isDemo: Boolean(r.is_demo),
        isPrivate: r.visibility === 'private',
        meta: `${length} · ${utcDay(startMs)}`,
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active));
}

function Row({ c }: { c: MyChallenge }) {
  return (
    <li>
      <Link
        href={`/challenges/${c.address}`}
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-lg px-3 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{c.title}</span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {c.meta} · {c.role}
            {c.isPrivate && <span className="rounded bg-muted px-1.5 py-px">Private</span>}
            {c.isDemo && <span className="rounded bg-muted px-1.5 py-px">Demo</span>}
          </span>
        </span>
        <span className="row-span-2 flex flex-col items-end gap-1 text-right">
          <Badge variant={c.outcome.variant}>{c.outcome.label}</Badge>
          <span className="text-xs tabular-nums text-muted-foreground">
            {c.money}
            {c.net && (
              <span className={`ml-1.5 font-medium ${c.netPositive === true ? 'text-success' : c.netPositive === false ? 'text-destructive-text' : ''}`}>{c.net}</span>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}

function Section({ title, hint, items, open, shown = 4 }: { title: string; hint: string; items: MyChallenge[]; open: boolean; shown?: number }) {
  if (!items.length) return null;
  const head = (
    <span className="flex items-baseline gap-2 px-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</span>
      <span className="rounded-full bg-muted px-2 py-px text-xs tabular-nums">{items.length}</span>
      <span className="hidden text-xs text-muted-foreground sm:inline">{hint}</span>
    </span>
  );
  const list = (rows: MyChallenge[]) => <ul className="divide-y divide-border">{rows.map((c) => <Row key={c.address} c={c} />)}</ul>;
  if (!open) {
    return (
      <details className="group space-y-1">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-lg py-1 hover:bg-muted/40">
          {head}
          <span className="px-3 text-xs text-muted-foreground group-open:hidden">Show</span>
          <span className="hidden px-3 text-xs text-muted-foreground group-open:inline">Hide</span>
        </summary>
        {list(items)}
      </details>
    );
  }
  return (
    <section className="space-y-1">
      {head}
      {list(items.slice(0, shown))}
      {items.length > shown && (
        <details className="group">
          <summary className="cursor-pointer list-none px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
            <span className="group-open:hidden">Show {items.length - shown} more</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          {list(items.slice(shown))}
        </details>
      )}
    </section>
  );
}

export function MyChallenges({ items }: { items: MyChallenge[] }) {
  const active = items.filter((c) => c.group === 'active');
  const finished = items.filter((c) => c.group === 'finished');
  const cancelled = items.filter((c) => c.group === 'cancelled');
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Your challenges</CardTitle>
          <CardDescription>
            Ones you created or play in, with your result and what you put in and got back.{' '}
            <Link className="underline underline-offset-4" href="/dashboard/history">
              Full history
            </Link>
          </CardDescription>
        </div>
        <Button asChild size="sm" variant="secondary">
          <Link href="/challenges/new">Create a challenge</Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">
            None yet. Create one, or join one from{' '}
            <Link className="underline underline-offset-4" href="/challenges">
              Challenges
            </Link>
            .
          </p>
        )}
        <Section title="Active" hint="Joining, starting or running" items={active} open />
        <Section title="Finished" hint="Settled, or ended and settling" items={finished} open />
        <Section title="Cancelled" hint="Too few players: every stake is refunded" items={cancelled} open={false} />
      </CardContent>
    </Card>
  );
}
