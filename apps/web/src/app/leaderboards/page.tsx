import { isSolanaAddress } from '@codestreak/shared/wallet';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LiveLeaderboards } from '@/components/leaderboards/live-leaderboards';
import { Reveal } from '@/components/motion/primitives';
import { nowSecs } from '@/lib/insights/load';
import { loadLeaderboards } from '@/lib/leaderboards/load';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Leaderboards' };
export const dynamic = 'force-dynamic';

export default async function LeaderboardsPage({ searchParams }: { searchParams: Promise<{ group?: string | string[] }> }) {
  const raw = (await searchParams).group;
  const group = Array.isArray(raw) ? raw[0] : raw;
  if (group && !isSolanaAddress(group)) notFound();

  const supabase = await createSupabaseServerClient();
  const viewer = await getViewer();
  const [data, mine] = await Promise.all([
    loadLeaderboards(supabase, nowSecs(), group),
    viewer
      ? supabase
          .from('memberships')
          .select('challenges!inner(title, onchain_address, pool_state, start_at, num_days, day_length_secs)')
          .eq('profile_id', viewer.userId)
          .not('challenges.onchain_address', 'is', null)
          .limit(100)
      : Promise.resolve({ data: [] }),
  ]);
  if (!data) notFound(); // unknown, or a private group the viewer is not in

  type Row = { title: string; onchain_address: string; pool_state: string; start_at: string; num_days: number; day_length_secs: number };
  const now = nowSecs() * 1000; // the same server clock helper the boards use (pure render)
  const groups = ((mine.data ?? []) as unknown as { challenges: Row | Row[] }[])
    .map((m) => (Array.isArray(m.challenges) ? m.challenges[0] : m.challenges))
    .filter((c): c is Row => Boolean(c?.onchain_address))
    .map((c) => {
      const start = Date.parse(c.start_at);
      const end = start + c.num_days * c.day_length_secs * 1000;
      const state: 'running' | 'finished' | 'cancelled' = c.pool_state === 'cancelled' ? 'cancelled' : c.pool_state === 'open' && now < end ? 'running' : 'finished';
      return { address: c.onchain_address, title: c.title, state, startDay: c.start_at.slice(0, 10), start };
    })
    .sort((a, b) => b.start - a.start)
    .map((g) => ({ address: g.address, title: g.title, state: g.state, startDay: g.startDay }));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Reveal trigger="mount" className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Leaderboards</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Ranked from on-chain-recorded days and payouts only, and updated live as the worker records results. Global counts public challenges; pick one of
          your groups to see just its players.
        </p>
      </Reveal>
      <LiveLeaderboards key={group ?? 'global'} initial={data} groups={groups} />
    </div>
  );
}
