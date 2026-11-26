'use client';

import { countdownText, crossedWarning, TODAY_LABELS, zonedClock, type TodayStatus } from '@codestreak/shared';
import { Activity, Bell, BellOff, Coins, Flame, Receipt, Target, Timer } from 'lucide-react';
import { KpiTile, type KpiTone } from '@/components/ui/kpi-tile';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Stagger, StaggerItem } from '@/components/motion/primitives';
import { useInbox } from '@/components/notifications/use-inbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ActiveView, DashboardView } from '@/lib/dashboard/load';
import { useSound, type Cue } from './use-sound';

// Recharts measures the DOM: render it in the browser only.
const ActivityChart = dynamic(() => import('./activity-chart').then((m) => m.ActivityChart), {
  ssr: false,
  loading: () => <div className="h-64 w-full animate-pulse rounded-lg bg-muted" />,
});

const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

const TODAY_VARIANT: Record<TodayStatus, 'success' | 'primary' | 'warning' | 'danger' | 'outline' | 'accent'> = {
  verified: 'success',
  shielded: 'accent',
  on_track: 'primary',
  behind: 'warning',
  unknown: 'warning',
  not_checked: 'outline',
  not_started: 'outline',
  undecided: 'warning',
  failed: 'danger',
  out: 'danger',
};

/** Seconds since the epoch, ticking every second; starts at the server's time (no hydration jump). */
function useSecondClock(serverNow: number): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000));
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  return now;
}

/** Live data: refresh on every new notification (Realtime), when a countdown ends, and every minute. */
function useLiveRefresh(view: DashboardView, now: number, play: (c: Cue) => void) {
  const router = useRouter();
  const inbox = useInbox(5);
  const top = useRef<string | null | undefined>(undefined);
  const refreshedFor = useRef(new Set<number>());
  const warned = useRef(new Set<string>());
  const prevNow = useRef(now);

  // A new notification (day result, payout, badge, warning, settlement...) → new server data.
  useEffect(() => {
    if (!inbox.loaded) return;
    const latest = inbox.items[0];
    const id = latest?.id ?? null;
    if (top.current === undefined) {
      top.current = id;
      return;
    }
    if (id === top.current) return;
    top.current = id;
    if (!latest) return;
    if (latest.kind === 'day_result') play(/ verified /.test(latest.title) ? 'success' : 'fail');
    else if (latest.kind === 'payout' || latest.kind === 'badge') play('coin');
    else if (latest.kind === 'deadline_warning') play('warning');
    router.refresh();
  }, [inbox.loaded, inbox.items, play, router]);

  // Countdowns: a deadline that passes means a new day (or a start) → reload; entering the warning window → cue.
  useEffect(() => {
    const before = prevNow.current;
    prevNow.current = now;
    for (const a of view.active) {
      if (now >= a.countdownTo && !refreshedFor.current.has(a.countdownTo)) {
        refreshedFor.current.add(a.countdownTo);
        // The worker needs a moment after the day ends; reloading right away is still correct.
        router.refresh();
      }
      const key = `${a.membershipId}:${a.countdownTo}`;
      if (a.day !== null && !warned.current.has(key) && crossedWarning(a.countdownTo, a.dayLengthSecs, before, now) && a.today !== 'verified' && a.today !== 'shielded') {
        warned.current.add(key);
        play('warning');
      }
    }
  }, [now, view.active, play, router]);

  // Every minute while the tab is visible.
  useEffect(() => {
    const id = setInterval(() => document.visibilityState === 'visible' && router.refresh(), 60_000);
    return () => clearInterval(id);
  }, [router]);

  return { live: inbox.signedIn !== undefined };
}

function DualClock({ at }: { at: number }) {
  return (
    <span className="text-xs text-muted-foreground">
      <time dateTime={new Date(at * 1000).toISOString()}>{zonedClock(at, 'UTC')}</time> · {zonedClock(at, 'IST')}
    </span>
  );
}

function Tile(props: { label: string; value: string; hint?: string; icon?: React.ReactNode; tone?: KpiTone }) {
  return <KpiTile {...props} />;
}

function ActiveCard({ a, now }: { a: ActiveView; now: number }) {
  const left = a.countdownTo - now;
  return (
    <Card className={a.warning ? 'ring-2 ring-warning-400/50' : undefined}>
      <CardHeader className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">
            {a.address ? (
              <Link className="hover:underline" href={`/challenges/${a.address}`}>
                {a.title}
              </Link>
            ) : (
              a.title
            )}
          </CardTitle>
          <Badge variant={TODAY_VARIANT[a.today]}>{TODAY_LABELS[a.today]}</Badge>
        </div>
        <CardDescription>
          {a.day === null ? `${a.numDays}-day challenge` : `Day ${a.day + 1} of ${a.numDays}`} · {a.stillIn} of {a.participants} still in
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Your stake</p>
          <p className="text-xl font-semibold tabular-nums">{a.stake}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Potential payout</p>
          <p className="text-xl font-semibold tabular-nums">{a.potentialPayout}</p>
          <p className={`text-xs ${a.profitPositive ? 'text-success' : 'text-muted-foreground'}`}>{a.potentialProfit} · estimate if everyone still in finishes</p>
        </div>
        <div>
          <p className="flex items-center gap-1 text-xs uppercase tracking-wide text-muted-foreground">
            <Timer className="size-3.5" aria-hidden />
            {a.countdownLabel}
          </p>
          <p className={`font-mono text-xl font-semibold tabular-nums ${a.warning ? 'text-warning' : ''}`} aria-live="off">
            {left > 0 ? countdownText(a.countdownTo, now) : 'now'}
          </p>
          <DualClock at={a.countdownTo} />
        </div>
        {a.warning && (
          <p className="text-sm text-warning sm:col-span-3">
            Less than the warning window left and today isn&apos;t met yet.{' '}
            {a.address && (
              <Link className="underline underline-offset-4" href={`/challenges/${a.address}`}>
                Check now
              </Link>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function LiveDashboard({ view }: { view: DashboardView }) {
  const now = useSecondClock(view.now);
  const { enabled, toggle, play } = useSound();
  useLiveRefresh(view, now, play);
  const [primary, ...others] = view.active;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-electric-400 opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-electric-400" />
          </span>
          Live · {zonedClock(now, 'UTC')} · {zonedClock(now, 'IST')}
        </p>
        <Button variant="outline" size="sm" onClick={toggle} aria-pressed={enabled}>
          {enabled ? <Bell className="size-4" aria-hidden /> : <BellOff className="size-4" aria-hidden />}
          {enabled ? 'Sound on' : 'Sound off'}
        </Button>
      </div>

      {view.isNew && <Welcome linked={view.linked} />}

      <Stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StaggerItem>
          <Tile
            tone="warning"
            icon={<Flame aria-hidden />}
            label="Current streak"
            value={`${view.streak.current} day${view.streak.current === 1 ? '' : 's'}`}
            hint={view.streak.recordedDays ? `Longest ${view.streak.longest}` : 'Starts with your first verified day'}
          />
        </StaggerItem>
        <StaggerItem>
          <Tile tone="success" icon={<Target aria-hidden />} label="Success rate" value={view.streak.successRate === null ? '—' : `${view.streak.successRate}%`} hint={`${view.streak.recordedDays} recorded day${view.streak.recordedDays === 1 ? '' : 's'}`} />
        </StaggerItem>
        <StaggerItem>
          <Tile tone="accent" icon={<Activity aria-hidden />} label="Active challenges" value={String(view.active.length)} hint={view.active.length ? undefined : 'None running'} />
        </StaggerItem>
        <StaggerItem>
          <Tile tone="primary" icon={<Coins aria-hidden />} label="Stake at risk" value={view.atRisk.length ? view.atRisk.map((r) => r.amount).join(' + ') : '0'} hint="In challenges still running" />
        </StaggerItem>
      </Stagger>

      <section aria-label="Active challenge" className="space-y-3">
        <h2 className="text-lg font-semibold">Today</h2>
        {primary ? (
          <>
            <ActiveCard a={primary} now={now} />
            {others.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2">
                {others.map((a) => (
                  <ActiveCard key={a.membershipId} a={a} now={now} />
                ))}
              </div>
            )}
          </>
        ) : (
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-6 text-sm text-muted-foreground">
              <span>No challenge running for you right now. Join one to put a stake on your streak.</span>
              <Button asChild size="sm">
                <Link href="/challenges">Browse challenges</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Activity, last 30 days</CardTitle>
            <CardDescription>Recorded day results and the commits and solves that counted (UTC dates).</CardDescription>
          </CardHeader>
          <CardContent>
            {view.activityTotal > 0 ? (
              <ActivityChart data={view.activity} />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">No recorded activity yet. Your verified days and counted commits appear here.</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Deadlines</CardTitle>
            <CardDescription>UTC and IST (UTC+05:30).</CardDescription>
          </CardHeader>
          <CardContent>
            {view.deadlines.length ? (
              <ul className="space-y-3">
                {view.deadlines.map((d) => (
                  <li key={`${d.address}:${d.at}:${d.label}`} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${d.warning ? 'text-warning' : ''}`}>{d.label}</p>
                      <p className="truncate text-xs text-muted-foreground">{d.title}</p>
                      <DualClock at={d.at} />
                    </div>
                    <span className={`shrink-0 font-mono text-sm tabular-nums ${d.warning ? 'text-warning' : ''}`}>{countdownText(d.at, now)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No upcoming deadlines.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Receipt className="size-4" aria-hidden />
            Recent receipts
          </CardTitle>
          <CardDescription>
            Sealed day receipts recorded on-chain, plus every payment in or out (stake, Shield, sponsorship, reward, refund). Each one links to its devnet transaction.{' '}
            <Link className="underline underline-offset-4" href="/dashboard/history">
              Full history
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {view.receipts.length ? (
            <ul className="divide-y divide-border">
              {view.receipts.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div className="min-w-0">
                    {r.href ? (
                      <Link className="font-medium hover:underline" href={r.href}>
                        {r.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.title}</span>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {r.detail} · {zonedClock(r.at, 'UTC')}
                    </p>
                  </div>
                  {r.tx && (
                    <a className="text-xs underline underline-offset-4" href={explorerTx(r.tx)} target="_blank" rel="noreferrer">
                      Transaction ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">No receipts yet. Each recorded day and each payout leaves one here.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Welcome({ linked }: { linked: DashboardView['linked'] }) {
  const steps = [
    { done: linked.github || linked.leetcode, title: 'Link GitHub or LeetCode', body: 'So your coding days can be verified.', href: '/dashboard/settings', cta: 'Link accounts' },
    { done: linked.wallet, title: 'Link a Solana wallet', body: 'Phantom or MetaMask (Solana), on devnet.', href: '/dashboard/wallet', cta: 'Open wallet' },
    { done: false, title: 'Join or create a challenge', body: 'Stake a little devnet USDC or SOL on your streak.', href: '/challenges', cta: 'Browse challenges' },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Welcome to CodeStreak</CardTitle>
        <CardDescription>Your dashboard fills in as soon as you join a challenge. Three steps to get there:</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.title} className="space-y-2 rounded-lg border border-border p-4">
            <p className="text-xs text-muted-foreground">Step {i + 1}</p>
            <p className="font-medium">
              {s.title} {s.done && <Badge variant="success">Done</Badge>}
            </p>
            <p className="text-sm text-muted-foreground">{s.body}</p>
            {!s.done && (
              <Button asChild size="sm" variant="secondary">
                <Link href={s.href}>{s.cta}</Link>
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
