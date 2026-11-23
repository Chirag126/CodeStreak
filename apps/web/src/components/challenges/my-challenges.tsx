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
  /** "0.01 SOL · 3 × 10 min · 23 Nov" */
  meta: string;
}

const utcDay = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Challenges the person created or plays in: active ones first, then the rest, newest first. */
export async function listMyChallenges(profileId: string): Promise<MyChallenge[]> {
  const admin = createSupabaseAdminClient();
  const [{ data: memberships }, { data: created }] = await Promise.all([
    admin.from('memberships').select('challenge_id').eq('profile_id', profileId).limit(200),
    admin.from('challenges').select('id').eq('creator_id', profileId).limit(200),
  ]);
  const playing = new Set((memberships ?? []).map((m) => m.challenge_id as string));
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
      const dayLen = r.day_length_secs as number;
      const length = dayLen >= 86400 ? `${r.num_days} days` : `${r.num_days} × ${Math.round(dayLen / 60)} min`;
      return {
        address: r.onchain_address as string,
        title: r.title as string,
        role: mine.has(id) && playing.has(id) ? 'Creator & player' : mine.has(id) ? 'Creator' : 'Player',
        badge,
        active: (status === 'joining' || status === 'starting' || status === 'running') && badge.label !== 'Too few players',
        isDemo: Boolean(r.is_demo),
        isPrivate: r.visibility === 'private',
        meta: `${formatAmount(BigInt(String(r.buy_in)), sol ? SOL_DECIMALS : USDC_DECIMALS)} ${sol ? 'SOL' : 'USDC'} · ${length} · ${utcDay(startMs)}`,
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active));
}

function Row({ c }: { c: MyChallenge }) {
  return (
    <li>
      <Link
        href={`/challenges/${c.address}`}
        className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_9.5rem_7.5rem]"
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">{c.title}</span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {c.meta}
            {c.isPrivate && <span className="rounded bg-muted px-1.5 py-px">Private</span>}
            {c.isDemo && <span className="rounded bg-muted px-1.5 py-px">Demo</span>}
          </span>
        </span>
        <span className="justify-self-end sm:justify-self-start">
          <Badge variant={c.badge.variant}>{c.badge.label}</Badge>
        </span>
        <span className="col-span-2 text-xs text-muted-foreground sm:col-span-1 sm:text-right">{c.role}</span>
      </Link>
    </li>
  );
}

export function MyChallenges({ items }: { items: MyChallenge[] }) {
  const active = items.filter((c) => c.active);
  const past = items.filter((c) => !c.active);
  const PAST_SHOWN = 4;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="space-y-1.5">
          <CardTitle>Your challenges</CardTitle>
          <CardDescription>Ones you created or play in.</CardDescription>
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
        {active.length > 0 && (
          <section className="space-y-1">
            <h3 className="px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Active ({active.length})</h3>
            <ul className="divide-y divide-border">{active.map((c) => <Row key={c.address} c={c} />)}</ul>
          </section>
        )}
        {past.length > 0 && (
          <section className="space-y-1">
            <h3 className="px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Past ({past.length})</h3>
            <ul className="divide-y divide-border">{past.slice(0, PAST_SHOWN).map((c) => <Row key={c.address} c={c} />)}</ul>
            {past.length > PAST_SHOWN && (
              <details className="group">
                <summary className="cursor-pointer list-none px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
                  <span className="group-open:hidden">Show {past.length - PAST_SHOWN} more</span>
                  <span className="hidden group-open:inline">Show fewer</span>
                </summary>
                <ul className="divide-y divide-border">{past.slice(PAST_SHOWN).map((c) => <Row key={c.address} c={c} />)}</ul>
              </details>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
