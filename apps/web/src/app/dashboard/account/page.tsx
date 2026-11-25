import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SIGN_IN_PATH } from '@/lib/auth/routes';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';
import { AppealForm } from './appeal-form';

export const metadata: Metadata = { title: 'Account' };
export const dynamic = 'force-dynamic';

const LABEL: Record<string, string> = {
  active: 'Active',
  under_review: 'Under review',
  suspended: 'Suspended',
  banned: 'Banned',
  pending_deletion: 'Scheduled for deletion',
  deleted: 'Deleted',
};
const FEATURE: Record<string, string> = {
  challenges: 'Joining or creating challenges',
  groups: 'Creating groups and inviting people',
  sponsorship: 'Sponsoring challenges',
  profile_hidden: 'Your public profile is hidden',
  reverify: 'Re-link GitHub / LeetCode in Settings to keep joining challenges',
};
const ACTION: Record<string, string> = {
  warn: 'Warning',
  suspend: 'Suspension',
  ban: 'Ban',
  reinstate: 'Reinstated',
  review: 'Placed under review',
  restrict: 'Features changed',
  require_reverify: 'Re-verification requested',
  edit_profile: 'Profile edited by CodeStreak',
  schedule_deletion: 'Deletion scheduled',
  cancel_deletion: 'Deletion cancelled',
  appeal_decide: 'Appeal decided',
};

/** The user's own standing: status, what is restricted and why, history, and the appeal form. */
export default async function AccountPage() {
  const viewer = await getViewer();
  if (!viewer) redirect(SIGN_IN_PATH);
  const supabase = await createSupabaseServerClient();
  const [{ data: st }, { data: actions }, { data: appeals }] = await Promise.all([
    supabase.rpc('my_account_status'),
    // Only id/action/date are readable by the user (column grants); internal reasons stay internal.
    supabase.from('moderation_actions').select('id, action, created_at').eq('profile_id', viewer.userId).order('created_at', { ascending: false }).limit(50),
    supabase.from('moderation_appeals').select('id, status, decision_note, created_at, decided_at').eq('profile_id', viewer.userId).order('created_at', { ascending: false }),
  ]);
  const s = (st ?? { status: 'active', restrictions: [] }) as { status: string; suspended_until: string | null; restrictions: string[]; reason: string | null; deletion_due_at: string | null; open_appeal: boolean };
  const visibleActions = (actions ?? []).filter((a) => ACTION[a.action as string]);
  const good = s.status === 'active' && s.restrictions.length === 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="space-y-1">
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
          ← Dashboard
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Account</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Status <Badge variant={good ? 'success' : s.status === 'banned' ? 'danger' : 'warning'}>{LABEL[s.status] ?? s.status}</Badge>
          </CardTitle>
          <CardDescription>{good ? 'Your account is in good standing.' : 'Some things are limited on your account. Details below.'}</CardDescription>
        </CardHeader>
        {!good && (
          <CardContent className="space-y-2 text-sm">
            {s.status === 'suspended' && <p>Suspended {s.suspended_until ? `until ${s.suspended_until.slice(0, 16).replace('T', ' ')} UTC` : 'until further notice'}.</p>}
            {s.status === 'pending_deletion' && s.deletion_due_at && <p>Scheduled for deletion on {s.deletion_due_at.slice(0, 10)}. Appeal below to keep your account.</p>}
            {s.reason && <p>Reason: {s.reason}</p>}
            {s.restrictions.length > 0 && (
              <ul className="list-disc pl-5">
                {s.restrictions.map((r) => (
                  <li key={r}>{FEATURE[r] ?? r}</li>
                ))}
              </ul>
            )}
            <p className="text-muted-foreground">Your funds in running challenges are not affected: payouts and refunds still reach your wallet automatically.</p>
          </CardContent>
        )}
      </Card>
      {!good && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Appeal</CardTitle>
            <CardDescription>A person reviews every appeal. You will get a notification with the decision.</CardDescription>
          </CardHeader>
          <CardContent>{s.open_appeal ? <p className="text-sm">Your appeal is under review.</p> : <AppealForm />}</CardContent>
        </Card>
      )}
      {(visibleActions.length > 0 || (appeals ?? []).length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">History</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm">
              {visibleActions.map((a) => (
                <li key={`a${a.id}`}>
                  <span className="font-mono text-xs text-muted-foreground">{String(a.created_at).slice(0, 10)}</span> {ACTION[a.action as string]}
                </li>
              ))}
              {(appeals ?? []).map((a) => (
                <li key={`p${a.id}`}>
                  <span className="font-mono text-xs text-muted-foreground">{String(a.created_at).slice(0, 10)}</span> Appeal: {String(a.status)}
                  {a.decision_note ? ` (${a.decision_note})` : ''}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
