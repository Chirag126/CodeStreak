import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SIGN_IN_PATH, USERNAME_PATH } from '@/lib/auth/routes';
import { loadInsights, nowSecs } from '@/lib/insights/load';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Coding insights' };
export const dynamic = 'force-dynamic';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default async function InsightsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect(SIGN_IN_PATH);
  if (!viewer.username) redirect(USERNAME_PATH);
  const { insights: i, challenges } = await loadInsights(await createSupabaseServerClient(), viewer.userId, nowSecs());
  const weekMax = Math.max(1, ...i.weekly.map((w) => w.verified + w.failed + w.indeterminate + w.shielded));
  const dayMax = Math.max(1, ...i.byWeekday);

  const tiles = [
    { label: 'Recorded days', value: String(i.recordedDays) },
    { label: 'Success rate', value: i.successRate === null ? '—' : `${i.successRate}%`, hint: 'verified ÷ (verified + failed)' },
    { label: 'Current streak', value: `${i.currentStreak} day${i.currentStreak === 1 ? '' : 's'}` },
    { label: 'Longest streak', value: `${i.longestStreak} day${i.longestStreak === 1 ? '' : 's'}` },
    { label: 'Commits counted', value: String(i.commits) },
    { label: 'Problems solved', value: String(i.solves) },
  ];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="space-y-2">
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
          ← Dashboard
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Coding insights</h1>
        <p className="text-sm text-muted-foreground">
          {i.recordedDays === 0
            ? 'Nothing yet: insights appear once your first challenge day is recorded on-chain.'
            : `Based on ${i.recordedDays} recorded day${i.recordedDays === 1 ? '' : 's'} across ${challenges} challenge${challenges === 1 ? '' : 's'} (results recorded on-chain and evidence that counted; "Check now" previews are not included). Days are dated by when they started, in UTC.`}
        </p>
      </div>

      <section aria-label="Totals" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardHeader className="pb-2">
              <CardDescription>{t.label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{t.value}</CardTitle>
            </CardHeader>
            {t.hint && <CardContent className="pt-0 text-xs text-muted-foreground">{t.hint}</CardContent>}
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Weekly summary</CardTitle>
          <CardDescription>Last 8 weeks (Monday to Sunday, UTC).</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2" aria-label="Weeks, oldest first">
            {i.weekly.map((w) => {
              const total = w.verified + w.failed + w.indeterminate + w.shielded;
              return (
                <li key={w.week} className="grid grid-cols-[6rem_1fr_auto] items-center gap-3 text-sm">
                  <span className="tabular-nums text-muted-foreground">{w.week}</span>
                  <span className="flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span className="bg-electric-400" style={{ width: `${(w.verified / weekMax) * 100}%` }} />
                    <span className="bg-cobalt-400" style={{ width: `${(w.shielded / weekMax) * 100}%` }} />
                    <span className="bg-warning-400" style={{ width: `${(w.indeterminate / weekMax) * 100}%` }} />
                    <span className="bg-danger-400" style={{ width: `${(w.failed / weekMax) * 100}%` }} />
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {total === 0 ? 'no days' : `${w.verified} passed${w.shielded ? `, ${w.shielded} shielded` : ''}${w.indeterminate ? `, ${w.indeterminate} undecided` : ''}${w.failed ? `, ${w.failed} failed` : ''}`}
                    {w.commits + w.solves > 0 && ` · ${w.commits} commits, ${w.solves} solves`}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span><span className="mr-1 inline-block size-2 rounded-full bg-electric-400" />passed</span>
            <span><span className="mr-1 inline-block size-2 rounded-full bg-cobalt-400" />shielded</span>
            <span><span className="mr-1 inline-block size-2 rounded-full bg-warning-400" />undecided</span>
            <span><span className="mr-1 inline-block size-2 rounded-full bg-danger-400" />failed</span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">When you code</CardTitle>
          <CardDescription>Verified days by weekday (UTC).</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 items-end gap-2" style={{ height: '7rem' }}>
            {i.byWeekday.map((n, k) => (
              <div key={WEEKDAYS[k]} className="flex h-full flex-col items-center justify-end gap-1">
                <span className="text-xs tabular-nums text-muted-foreground">{n}</span>
                <span className="w-full rounded-t bg-electric-400/80" style={{ height: `${(n / dayMax) * 70}%`, minHeight: n ? 4 : 0 }} />
                <span className="text-xs text-muted-foreground">{WEEKDAYS[k]}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
