import { formatAmount, TOKEN_DECIMALS, type Token } from '@codestreak/shared';
import Link from 'next/link';
import { StreakGrid } from '@/components/landing/streak-grid';
import { AnimatedNumber, Reveal } from '@/components/motion/primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getPublicEnv } from '@/lib/env';
import { nowSecs } from '@/lib/insights/load';
import { loadEscrow, loadFeatured, loadLandingStats } from '@/lib/landing/load';
import { getViewer } from '@/lib/supabase/server';

// Live numbers on every request (database and chain); nothing is baked in at build time.
export const dynamic = 'force-dynamic';

const money = (v: Partial<Record<Token, bigint>> | null) => {
  if (!v) return '—';
  const parts = (Object.entries(v) as [Token, bigint][]).filter(([, x]) => x > 0n).map(([t, x]) => `${formatAmount(x, TOKEN_DECIMALS[t])} ${t.toUpperCase()}`);
  return parts.length ? parts.join(' · ') : '0';
};

const STEPS = [
  { title: 'Link your accounts', body: 'Connect GitHub or LeetCode and a Solana wallet.' },
  { title: 'Stake on a challenge', body: 'Join with a buy-in, held by the program, not by us.' },
  { title: 'Code every day', body: 'Each day is checked automatically and recorded on Solana.' },
  { title: 'Survivors split the pool', body: 'Keep your streak, share the pot and get a soulbound badge.' },
];

/**
 * Phase 40 landing page. Kept short on purpose: hero with the live streak grid, one row of real
 * numbers, open challenges, how it works, and a call to action. Every figure comes from the
 * database (public.landing_stats) or the chain; one that can't be read shows "—".
 */
export default async function HomePage() {
  const now = nowSecs();
  const [viewer, stats, featured, escrow] = await Promise.all([getViewer(), loadLandingStats(), loadFeatured(new Date(now * 1000).toISOString()), loadEscrow()]);
  const env = getPublicEnv();
  const deployment: [string, string][] = [
    ['Network', env.NEXT_PUBLIC_SOLANA_CLUSTER],
    ['RPC', new URL(env.NEXT_PUBLIC_SOLANA_RPC_URL).host],
    ['Program', env.NEXT_PUBLIC_CODESTREAK_PROGRAM_ID ?? 'not deployed'],
  ];
  const numbers: { label: string; source: 'database' | 'chain'; value: number | string | null }[] = [
    { label: 'Players', source: 'database', value: stats?.players ?? null },
    { label: 'Challenges', source: 'database', value: stats?.challenges ?? null },
    { label: 'Days verified on-chain', source: 'database', value: stats?.verifiedDays ?? null },
    { label: 'Badges minted', source: 'database', value: stats?.badges ?? null },
    { label: 'In escrow now', source: 'chain', value: money(escrow) },
  ];

  return (
    <div className="bg-dots">
      <div className="mx-auto flex max-w-5xl flex-col gap-14 px-4 py-16 sm:px-6 sm:py-20">
        {/* Hero */}
        <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
          <Reveal trigger="mount" className="space-y-5">
            <Badge variant="primary">Devnet · tokens have no real value</Badge>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Put your money where your <span className="text-electric-400">commits</span> are.
            </h1>
            <p className="max-w-xl text-pretty text-muted-foreground">
              CodeStreak turns daily coding into a commitment you can verify: stake on your streak, prove it with GitHub and LeetCode, settle on Solana.
            </p>
            <div className="flex flex-wrap gap-2">
              {viewer ? (
                <Button asChild>
                  <Link href="/dashboard">Go to dashboard</Link>
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/sign-in">Start a streak</Link>
                </Button>
              )}
              <Button asChild variant="outline">
                <Link href="/challenges">Browse challenges</Link>
              </Button>
            </div>
          </Reveal>
          <Reveal trigger="mount" delay={0.1}>
            <Card>
              <CardContent className="py-5">{stats ? <StreakGrid days={stats.grid} /> : <p className="py-8 text-center text-sm text-muted-foreground">Activity is unavailable right now.</p>}</CardContent>
            </Card>
          </Reveal>
        </section>

        {/* Live numbers */}
        <Reveal>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-5">
            {numbers.map((n) => (
              <div key={n.label} className="bg-background p-4">
                <dd className="text-xl font-semibold tabular-nums">{typeof n.value === 'number' ? <AnimatedNumber value={n.value} /> : (n.value ?? '—')}</dd>
                <dt className="mt-1 text-xs text-muted-foreground">{n.label}</dt>
                <span className="mt-1 block text-[10px] tracking-wide text-muted-foreground/70 uppercase">{n.source === 'chain' ? 'read from Solana' : 'from the database'}</span>
              </div>
            ))}
          </dl>
        </Reveal>

        {/* Open challenges */}
        <section className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-xl font-semibold tracking-tight">Open to join</h2>
            <Link href="/challenges" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
              All challenges
            </Link>
          </div>
          {featured === null ? (
            <p className="text-sm text-muted-foreground">Challenges are unavailable right now.</p>
          ) : featured.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No public challenge is open for joining right now.{' '}
              <Link href="/challenges/new" className="text-foreground underline underline-offset-4">
                Create one
              </Link>
              .
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {featured.map((c) => (
                <Link key={c.address} href={`/challenges/${c.address}`} className="group">
                  <Card className="h-full transition-colors group-hover:border-electric-400/50">
                    <CardContent className="space-y-3 py-4">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="line-clamp-2 font-medium">{c.title}</h3>
                        {c.demo && <Badge variant="warning">Demo</Badge>}
                      </div>
                      <dl className="grid grid-cols-2 gap-y-1 text-sm">
                        <dt className="text-muted-foreground">Buy-in</dt>
                        <dd className="text-right tabular-nums">{money({ [c.token]: c.buyIn })}</dd>
                        <dt className="text-muted-foreground">Pool</dt>
                        <dd className="text-right tabular-nums">{money({ [c.token]: c.pool })}</dd>
                        <dt className="text-muted-foreground">Players</dt>
                        <dd className="text-right tabular-nums">
                          {c.players}/{c.maxPlayers}
                        </dd>
                        <dt className="text-muted-foreground">Length</dt>
                        <dd className="text-right">{`${c.numDays} ${c.demo ? 'demo days' : 'days'}`}</dd>
                      </dl>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* How it works */}
        <section className="space-y-4">
          <h2 className="text-xl font-semibold tracking-tight">How it works</h2>
          <ol className="grid gap-3 sm:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-xl border border-border p-4">
                <span className="text-xs font-semibold text-electric-400">{`0${i + 1}`}</span>
                <p className="mt-1 font-medium">{s.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-sm">
            <Badge variant="outline">Demo · example data</Badge>
            <span className="text-muted-foreground">What a checked day looks like:</span>
            <span>
              Day 3 <Badge variant="success">verified</Badge> 2 commits, 41 meaningful lines in your own repo, recorded on Solana.
            </span>
          </div>
        </section>

        {/* Call to action */}
        <section className="flex flex-col items-start justify-between gap-4 rounded-xl border border-border p-6 sm:flex-row sm:items-center">
          <div>
            <p className="text-lg font-semibold">Ready to keep a streak you can prove?</p>
            <p className="text-sm text-muted-foreground">Free to try on devnet with test tokens.</p>
          </div>
          <Button asChild>
            <Link href={viewer ? '/challenges' : '/sign-in'}>{viewer ? 'Find a challenge' : 'Get started'}</Link>
          </Button>
        </section>

        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer select-none">Deployment details</summary>
          <dl className="mt-3 divide-y divide-border rounded-lg border border-border px-4">
            {deployment.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-6 py-2.5">
                <dt>{label}</dt>
                <dd className="truncate font-mono text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      </div>
    </div>
  );
}
