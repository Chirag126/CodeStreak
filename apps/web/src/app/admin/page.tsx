import { formatAmount } from '@codestreak/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader, StatCard } from '@/components/admin/ui';
import { TimeseriesChart } from '@/components/admin/timeseries-chart';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { loadOverview } from '@/lib/admin/data';
import { requireOwnerPage } from '@/lib/admin/owner';

export const metadata: Metadata = { title: 'Overview' };

export default async function AdminOverview() {
  const owner = await requireOwnerPage();
  const o = await loadOverview(owner.id);
  const s = o.series.map((p) => ({ ...p, date: String(p.date) }));
  return (
    <>
      <PageHeader title="Overview" description="Live from the database and the chain mirror. No sample data: every number is a count of real rows." />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Registered users" value={o.users} hint={`${o.new_7d} new in 7 days`} />
        <StatCard label="Active (7 days)" value={o.active_7d} hint="Signed in during the last week" />
        <StatCard label="Suspended · banned" value={`${o.suspended} · ${o.banned}`} tone={o.suspended + o.banned > 0 ? 'warn' : undefined} />
        <StatCard label="Open reports · appeals" value={`${o.open_reports} · ${o.open_appeals}`} tone={o.open_reports + o.open_appeals > 0 ? 'warn' : undefined} hint="Reports & Moderation" />
        <StatCard label="Challenges" value={o.challenges} hint={`${o.challenges_open} open · ${o.challenges_settled} settled`} />
        <StatCard label="Groups (private)" value={o.groups} />
        <StatCard label="Verified coding days" value={o.verified_days} hint={`${o.failed_days} failed · ${o.indeterminate_days} undecided`} />
        <StatCard label="Sponsorships" value={o.sponsorships} />
        <StatCard label="USDC in challenges" value={`${formatAmount(BigInt(o.usdc_staked), 6)} USDC`} hint="Stakes, sponsorships and Shields (receipts)" />
        <StatCard label="SOL in challenges" value={`${formatAmount(BigInt(o.sol_staked), 9)} SOL`} hint="Stakes, sponsorships and Shields (receipts)" />
        <StatCard label="Pending payouts" value={o.pending_claims} tone={o.pending_claims > 0 ? 'warn' : 'good'} hint="Owed after settlement, not yet paid" />
        <StatCard label="Failed transactions" value={o.failed_transactions} tone={o.failed_transactions > 0 ? 'danger' : 'good'} hint="Relayer requests that failed" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registrations &amp; participation</CardTitle>
            <CardDescription>Daily, last 30 days (UTC).</CardDescription>
          </CardHeader>
          <CardContent>
            <TimeseriesChart data={s} bars={[{ key: 'signups', label: 'Sign-ups' }]} lines={[{ key: 'joins', label: 'Challenge joins' }]} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Verification outcomes</CardTitle>
            <CardDescription>Days recorded on-chain per day.</CardDescription>
          </CardHeader>
          <CardContent>
            <TimeseriesChart
              data={s}
              bars={[
                { key: 'verified', label: 'Verified' },
                { key: 'indeterminate', label: 'Undecided' },
                { key: 'failed', label: 'Failed' },
              ]}
            />
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Transaction volume</CardTitle>
            <CardDescription>
              Confirmed transactions mirrored per day (joins, Shields, sponsorships, payouts). Details in{' '}
              <Link className="underline underline-offset-4" href="/admin/transactions">
                Transactions
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TimeseriesChart data={s} bars={[{ key: 'transactions', label: 'Transactions' }]} height={180} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
