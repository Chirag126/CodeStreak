import { formatAmount, usernameFromPath, OUTCOME_LABELS, TOKEN_DECIMALS, utcAndIst, type HistoryOutcome, type Token } from '@codestreak/shared';
import { explorerAddressUrl, explorerTxUrl } from '@codestreak/shared/program';
import { Flame, GitBranch, Medal, Trophy } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { Reveal } from '@/components/motion/primitives';
import { RefreshOnFocus } from '@/components/motion/refresh-on-focus';
import { AutoRefresh } from '@/components/profile/auto-refresh';
import { ShareButton } from '@/components/profile/share-button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { nowSecs } from '@/lib/insights/load';
import { loadPublicProfile } from '@/lib/profile/load';

export const dynamic = 'force-dynamic';

// One load per request, shared by the page and its metadata.
const load = cache(async (raw: string) => {
  const username = usernameFromPath(raw);
  return username ? loadPublicProfile(username, nowSecs()) : null;
});

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const p = await load((await params).username);
  if (!p) return { title: 'Profile not found' };
  const name = p.displayName ?? `@${p.username}`;
  const description = `${name} on CodeStreak: longest streak ${p.stats.longestStreak} days, ${p.stats.survived} challenge${p.stats.survived === 1 ? '' : 's'} survived, ${p.badges.length} soulbound badge${p.badges.length === 1 ? '' : 's'}.`;
  return { title: `${name} (@${p.username})`, description, openGraph: { title: `${name} on CodeStreak`, description } };
}

const VARIANT: Record<HistoryOutcome, 'success' | 'danger' | 'warning' | 'outline' | 'primary' | 'accent'> = {
  survived: 'success',
  failed: 'danger',
  refunded: 'outline',
  voided: 'warning',
  cancelled: 'outline',
  running: 'primary',
  awaiting_settlement: 'accent',
  sponsored: 'accent',
};
const amount = (units: bigint, token: Token) => `${formatAmount(units, TOKEN_DECIMALS[token])} ${token.toUpperCase()}`;
const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

function Stat({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
        </p>
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default async function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const p = await load((await params).username);
  if (!p) notFound();
  const name = p.displayName ?? `@${p.username}`;
  const initials = (p.displayName ?? p.username).slice(0, 2).toUpperCase();
  const earned = (Object.entries(p.stats.earned) as [Token, bigint][]).map(([t, v]) => amount(v, t));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-12 sm:px-6">
      <RefreshOnFocus />
      <AutoRefresh everyMs={60_000} />
      <Reveal trigger="mount">
        <Card>
          <CardContent className="flex flex-col gap-5 py-6 sm:flex-row sm:items-center">
            {p.avatarUrl ? (
              // A plain <img>: avatars come from the user's own URL or GitHub.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.avatarUrl} alt="" width={88} height={88} referrerPolicy="no-referrer" className="size-22 shrink-0 rounded-full border border-border bg-muted object-cover" />
            ) : (
              <div className="flex size-22 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-2xl font-semibold" aria-hidden>
                {initials}
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1.5">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{name}</h1>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span>@{p.username}</span>
                <span className="font-mono">{p.publicId}</span>
                <span>Member since {p.memberSince}</span>
              </p>
              {p.linked.length > 0 ? (
                <ul className="flex flex-wrap gap-2 pt-1" aria-label="Linked accounts">
                  {p.linked.map((l) => (
                    <li key={l.provider}>
                      <a href={l.url} target="_blank" rel="noreferrer nofollow" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs hover:bg-muted">
                        {l.provider === 'github' ? <GitBranch className="size-3.5" aria-hidden /> : <span aria-hidden>LC</span>}
                        {l.username}
                        <span className="sr-only">on {l.provider === 'github' ? 'GitHub' : 'LeetCode'}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No linked coding accounts yet.</p>
              )}
            </div>
            <ShareButton path={`/u/${p.username}`} title={`${name} on CodeStreak`} />
          </CardContent>
        </Card>
      </Reveal>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<Flame className="size-3.5" aria-hidden />} label="Current streak" value={`${p.stats.currentStreak} day${p.stats.currentStreak === 1 ? '' : 's'}`} hint={`Longest ${p.stats.longestStreak}`} />
        <Stat label="Success rate" value={p.stats.successRate === null ? '—' : `${p.stats.successRate}%`} hint={`${p.stats.recordedDays} recorded day${p.stats.recordedDays === 1 ? '' : 's'}`} />
        <Stat
          icon={<Trophy className="size-3.5" aria-hidden />}
          label="Survived"
          value={`${p.stats.survived} of ${p.stats.finished}`}
          hint={`Finished challenges kept to the end · ${p.stats.challenges} joined`}
        />
        <Stat label="Rewards earned" value={earned.length ? earned.join(' · ') : '—'} hint="Above the stake, after settlement" />
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">
        Totals include private groups as numbers only. A private group&apos;s name, members, dates and transactions are never shown.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Medal className="size-4" aria-hidden />
            Soulbound badges
          </CardTitle>
          <CardDescription>Token-2022 badges minted by the CodeStreak program for each challenge survived. They cannot be transferred, so they can&apos;t be bought.</CardDescription>
        </CardHeader>
        <CardContent>
          {p.badges.length ? (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {p.badges.map((b, i) => (
                <li key={b.mint ?? `private-${b.numDays}-${i}`} className="flex items-center gap-3 rounded-lg border border-border p-3">
                  <div className="flex size-12 shrink-0 flex-col items-center justify-center rounded-full border-4 border-amber-500 text-sm font-bold leading-none">
                    {b.numDays}
                    <span className="text-[9px] font-medium tracking-widest text-amber-400">DAYS</span>
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    {b.address ? (
                      <Link className="block truncate text-sm font-medium hover:underline" href={`/challenges/${b.address}`}>
                        {b.title}
                      </Link>
                    ) : (
                      <p className="truncate text-sm font-medium">
                        {b.title} <span className="text-xs font-normal text-muted-foreground">(details hidden)</span>
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {b.inWallet === true ? 'Held in wallet · read from chain' : b.inWallet === false ? 'Not in the wallet right now' : 'Minted (chain busy, not re-checked)'}
                    </p>
                    {b.mint && (
                      <a className="text-xs underline underline-offset-4" href={explorerAddressUrl(b.mint)} target="_blank" rel="noreferrer">
                        Token on Explorer ↗
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">No badges yet. A soulbound badge is minted for every challenge survived.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
          <CardDescription>Every public challenge, with its on-chain transactions. Days: verified / missed / shielded.</CardDescription>
        </CardHeader>
        <CardContent>
          {p.history.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <caption className="sr-only">Public challenge history</caption>
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2 pr-3">Challenge</th>
                    <th scope="col" className="py-2 pr-3">Dates (UTC)</th>
                    <th scope="col" className="py-2 pr-3">Result</th>
                    <th scope="col" className="py-2 pr-3 text-right">Days ✓ / ✗ / 🛡</th>
                    <th scope="col" className="py-2 pr-3 text-right">Stake → received</th>
                    <th scope="col" className="py-2">Transactions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {p.history.map((h) => (
                    <tr key={h.address}>
                      <td className="py-2.5 pr-3">
                        <Link className="font-medium hover:underline" href={`/challenges/${h.address}`}>
                          {h.title}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{h.numDays} days</span>
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-muted-foreground">
                        {date(h.startTs)} → {date(h.endTs)}
                      </td>
                      <td className="py-2.5 pr-3">
                        <Badge variant={VARIANT[h.outcome]}>{OUTCOME_LABELS[h.outcome]}</Badge>
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {h.verified} / {h.failed} / {h.shielded}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {amount(h.stake, h.token)} → {h.received === null ? '—' : amount(h.received, h.token)}
                      </td>
                      <td className="py-2.5">
                        <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                          {h.joinTx && (
                            <a className="underline underline-offset-4" href={explorerTxUrl(h.joinTx)} target="_blank" rel="noreferrer">
                              Join ↗
                            </a>
                          )}
                          {h.payoutTx && (
                            <a className="underline underline-offset-4" href={explorerTxUrl(h.payoutTx)} target="_blank" rel="noreferrer">
                              Payout ↗
                            </a>
                          )}
                          {h.badgeMint && (
                            <a className="underline underline-offset-4" href={explorerAddressUrl(h.badgeMint)} target="_blank" rel="noreferrer">
                              Badge ↗
                            </a>
                          )}
                          {!h.joinTx && !h.payoutTx && !h.badgeMint && <span className="text-muted-foreground">—</span>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">No public challenges yet.</p>
          )}
          {p.privateChallenges > 0 && (
            <p className="pt-3 text-xs text-muted-foreground">
              + {p.privateChallenges} private challenge{p.privateChallenges === 1 ? '' : 's'} (details hidden; counted in the totals above).
            </p>
          )}
        </CardContent>
      </Card>

      <p className="text-center text-xs text-muted-foreground">
        Results, payouts and badges are read from Solana devnet records. Updated {utcAndIst(nowSecs())}; refreshes by itself every minute.
      </p>
    </div>
  );
}
