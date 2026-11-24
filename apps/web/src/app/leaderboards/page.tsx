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
      ? supabase.from('memberships').select('challenges!inner(title, onchain_address)').eq('profile_id', viewer.userId).not('challenges.onchain_address', 'is', null).limit(50)
      : Promise.resolve({ data: [] }),
  ]);
  if (!data) notFound(); // unknown, or a private group the viewer is not in

  const groups = ((mine.data ?? []) as unknown as { challenges: { title: string; onchain_address: string } | { title: string; onchain_address: string }[] }[])
    .map((m) => (Array.isArray(m.challenges) ? m.challenges[0] : m.challenges))
    .filter((c): c is { title: string; onchain_address: string } => Boolean(c?.onchain_address))
    .map((c) => ({ address: c.onchain_address, title: c.title }));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Reveal trigger="mount" className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Leaderboards</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Ranked from on-chain-recorded days and payouts only, and updated live as the worker records results. Pick Global, or one of your groups.
        </p>
      </Reveal>
      <LiveLeaderboards key={group ?? 'global'} initial={data} groups={groups} />
    </div>
  );
}
