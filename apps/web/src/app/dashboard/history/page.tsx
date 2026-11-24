import { filterHistory, formatAmount, OUTCOME_LABELS, parseHistoryFilters, summarizeHistory, TOKEN_DECIMALS, type HistoryOutcome, type Token } from '@codestreak/shared';
import { Download } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Reveal } from '@/components/motion/primitives';
import { RefreshOnFocus } from '@/components/motion/refresh-on-focus';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SIGN_IN_PATH, USERNAME_PATH } from '@/lib/auth/routes';
import { loadHistory } from '@/lib/history/load';
import { nowSecs } from '@/lib/insights/load';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'History' };
export const dynamic = 'force-dynamic';

const VARIANT: Record<HistoryOutcome, 'success' | 'danger' | 'warning' | 'outline' | 'primary' | 'accent'> = {
  survived: 'success',
  failed: 'danger',
  voided: 'warning',
  cancelled: 'outline',
  running: 'primary',
  awaiting_settlement: 'accent',
  sponsored: 'accent',
};

const amount = (units: bigint, token: Token) => `${formatAmount(units, TOKEN_DECIMALS[token])} ${token.toUpperCase()}`;
const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const explorerAddress = (a: string) => `https://explorer.solana.com/address/${a}?cluster=devnet`;
const selectClass = 'h-9 rounded-md border border-input bg-background px-2 text-sm';

export default async function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await getViewer();
  if (!viewer) redirect(SIGN_IN_PATH);
  if (!viewer.username) redirect(USERNAME_PATH);
  const filters = parseHistoryFilters(await searchParams);
  const all = await loadHistory(await createSupabaseServerClient(), viewer.userId, nowSecs());
  const rows = filterHistory(all, filters);
  const sum = summarizeHistory(rows);
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v && v !== 'all') as [string, string][]).toString();
  const filtered = query.length > 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12 sm:px-6">
      <RefreshOnFocus />
      <Reveal trigger="mount" className="space-y-2">
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
          ← Dashboard
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">History</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every challenge you played or sponsored: its outcome, your recorded days, what you put in and what came back. Days and amounts are from
          on-chain records; times are UTC.
        </p>
      </Reveal>

      {all.length === 0 ? (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-8 text-sm text-muted-foreground">
            <span>Nothing here yet. Every challenge you join or sponsor will be listed here, for good.</span>
            <Button asChild size="sm">
              <Link href="/challenges">Browse challenges</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-3" aria-label="Filter history">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Search
              <input name="q" defaultValue={filters.q} maxLength={80} placeholder="Challenge title" className={`${selectClass} w-48`} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Role
              <select name="role" defaultValue={filters.role} className={selectClass}>
                <option value="all">All</option>
                <option value="player">Player</option>
                <option value="sponsor">Sponsor</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Outcome
              <select name="outcome" defaultValue={filters.outcome} className={selectClass}>
                <option value="all">All</option>
                {(Object.keys(OUTCOME_LABELS) as HistoryOutcome[]).map((o) => (
                  <option key={o} value={o}>
                    {OUTCOME_LABELS[o]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Token
              <select name="token" defaultValue={filters.token} className={selectClass}>
                <option value="all">All</option>
                <option value="usdc">USDC</option>
                <option value="sol">SOL</option>
              </select>
            </label>
            <Button type="submit" size="sm">
              Apply
            </Button>
            {filtered && (
              <Button asChild size="sm" variant="ghost">
                <Link href="/dashboard/history">Clear</Link>
              </Button>
            )}
            <Button asChild size="sm" variant="outline" className="ml-auto">
              <a href={`/dashboard/history/export${query ? `?${query}` : ''}`} download>
                <Download className="size-4" aria-hidden />
                Export CSV{filtered ? ' (filtered)' : ''}
              </a>
            </Button>
          </form>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Challenges', value: String(sum.challenges) },
              { label: 'Survived · failed', value: `${sum.survived} · ${sum.failed}` },
              { label: 'Verified days', value: String(sum.verifiedDays) },
              {
                label: 'In → back',
                value:
                  (Object.entries(sum.money) as [Token, { put: bigint; received: bigint }][]).map(([t, m]) => `${amount(m.put, t)} → ${amount(m.received, t)}`).join(' · ') ||
                  '—',
              },
            ].map((t) => (
              <Card key={t.label}>
                <CardContent className="space-y-1 py-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.label}</p>
                  <p className="text-lg font-semibold tabular-nums">{t.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {rows.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No challenge matches these filters.{' '}
                <Link className="underline underline-offset-4" href="/dashboard/history">
                  Clear filters
                </Link>
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[56rem] text-sm">
                <caption className="sr-only">Your challenge history</caption>
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2">Challenge</th>
                    <th scope="col" className="px-3 py-2">Dates (UTC)</th>
                    <th scope="col" className="px-3 py-2">Outcome</th>
                    <th scope="col" className="px-3 py-2 text-right">Days ✓ / ✗ / 🛡 / ?</th>
                    <th scope="col" className="px-3 py-2 text-right">Put in</th>
                    <th scope="col" className="px-3 py-2 text-right">Received</th>
                    <th scope="col" className="px-3 py-2">Badge</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td className="px-3 py-2">
                        {r.address ? (
                          <Link className="font-medium hover:underline" href={`/challenges/${r.address}${r.role === 'player' ? '#my-days' : ''}`}>
                            {r.title}
                          </Link>
                        ) : (
                          <span className="font-medium">{r.title}</span>
                        )}
                        <span className="block text-xs text-muted-foreground">
                          {r.role === 'sponsor' ? 'Sponsor' : 'Player'} · {r.numDays} days
                        </span>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {date(r.startTs)} → {date(r.endTs)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={VARIANT[r.outcome]}>{OUTCOME_LABELS[r.outcome]}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.role === 'sponsor' ? '—' : `${r.verified} / ${r.failed} / ${r.shielded} / ${r.undecided}`}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{amount(r.put, r.token)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.received > 0n ? amount(r.received, r.token) : '—'}</td>
                      <td className="px-3 py-2">
                        {r.badgeMint ? (
                          <a className="underline underline-offset-4" href={explorerAddress(r.badgeMint)} target="_blank" rel="noreferrer">
                            🏅 Explorer ↗
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
