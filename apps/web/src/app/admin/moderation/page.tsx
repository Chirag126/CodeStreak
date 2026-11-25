import type { Metadata } from 'next';
import Link from 'next/link';
import { DecisionButton } from '@/components/admin/moderation-panel';
import { Empty, PageHeader, Table, td, when } from '@/components/admin/ui';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { loadModeration } from '@/lib/admin/data';
import { requireOwnerPage } from '@/lib/admin/owner';

export const metadata: Metadata = { title: 'Reports & Moderation' };
type Row = Record<string, unknown>;
const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T;

export default async function ModerationPage() {
  await requireOwnerPage();
  const { reports, appeals, actions } = await loadModeration();
  const openReports = (reports as Row[]).filter((r) => r.status === 'open' || r.status === 'reviewing');
  const openAppeals = (appeals as Row[]).filter((a) => a.status === 'open');
  return (
    <>
      <PageHeader title="Reports & Moderation" description="Reports from users, appeals against your decisions, and every moderation action. Open a user to act on their account." />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open reports ({openReports.length})</CardTitle>
          <CardDescription>Users can report a profile from its public page (5 a day, one open report per person).</CardDescription>
        </CardHeader>
        <CardContent>
          {openReports.length === 0 ? (
            <Empty>No open reports.</Empty>
          ) : (
            <Table head={['Reported', 'Reason', 'Details', 'By', 'When', '']}>
              {openReports.map((r) => {
                const target = one<Row>(r.reported);
                return (
                  <tr key={String(r.id)}>
                    <td className={td}>
                      <Link className="underline-offset-4 hover:underline" href={`/admin/users/${target.id}`}>
                        @{String(target.username ?? '?')}
                      </Link>
                    </td>
                    <td className={td}>{String(r.reason)}</td>
                    <td className={`${td} max-w-sm whitespace-pre-wrap text-xs`}>{String(r.details ?? '—')}</td>
                    <td className={td}>@{String(one<Row | null>(r.reporter)?.username ?? 'deleted')}</td>
                    <td className={td}>{when(r.created_at as string)}</td>
                    <td className={`${td} space-x-1 whitespace-nowrap`}>
                      <DecisionButton userId={String(target.id)} username={(target.username as string) ?? null} action="report_set" params={{ report_id: r.id, status: 'actioned' }} label="Actioned" />
                      <DecisionButton userId={String(target.id)} username={(target.username as string) ?? null} action="report_set" params={{ report_id: r.id, status: 'dismissed' }} label="Dismiss" />
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open appeals ({openAppeals.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {openAppeals.length === 0 ? (
            <Empty>No open appeals.</Empty>
          ) : (
            <ul className="space-y-2 text-sm">
              {openAppeals.map((a) => {
                const u = one<Row>(a.profile);
                return (
                  <li key={String(a.id)} className="space-y-1.5 rounded-md border border-border p-3">
                    <p>
                      <Link className="font-medium underline-offset-4 hover:underline" href={`/admin/users/${u.id}`}>
                        @{String(u.username ?? '?')}
                      </Link>{' '}
                      <span className="text-xs text-muted-foreground">{when(a.created_at as string)}</span>
                    </p>
                    <p className="whitespace-pre-wrap">{String(a.message)}</p>
                    <div className="flex gap-2">
                      <DecisionButton userId={String(u.id)} username={(u.username as string) ?? null} action="appeal_decide" params={{ appeal_id: a.id, accept: true }} label="Accept & reinstate" variant="default" />
                      <DecisionButton userId={String(u.id)} username={(u.username as string) ?? null} action="appeal_decide" params={{ appeal_id: a.id, accept: false }} label="Reject" />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent moderation actions</CardTitle>
        </CardHeader>
        <CardContent>
          {actions.length === 0 ? (
            <Empty>No actions yet.</Empty>
          ) : (
            <Table head={['User', 'Action', 'Reason', 'When']}>
              {(actions as Row[]).map((a) => {
                const u = one<Row>(a.profile);
                return (
                  <tr key={String(a.id)}>
                    <td className={td}>
                      <Link className="underline-offset-4 hover:underline" href={`/admin/users/${u.id}`}>
                        @{String(u.username ?? '?')}
                      </Link>
                    </td>
                    <td className={td}>
                      <Badge variant="outline">{String(a.action).replace('_', ' ')}</Badge>
                    </td>
                    <td className={`${td} text-xs`}>{String(a.reason)}</td>
                    <td className={td}>{when(a.created_at as string)}</td>
                  </tr>
                );
              })}
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
