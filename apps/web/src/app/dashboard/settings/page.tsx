import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { syncGithub } from '@/lib/accounts/github';
import { leetcodeStatus } from '@/lib/accounts/leetcode';
import { getViewer } from '@/lib/supabase/server';
import { GithubCard } from './github-card';
import { LeetcodeCard } from './leetcode-card';

export const metadata: Metadata = { title: 'Settings' };

const LINK_ERRORS: Record<string, string> = {
  identity_already_exists: 'That GitHub account is already linked to another CodeStreak account.',
  identity_already_linked: 'That GitHub account is already linked to another CodeStreak account.',
  manual_linking_disabled: 'GitHub linking is not enabled in Supabase yet (Allow manual linking).',
  access_denied: 'GitHub linking was cancelled.',
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ link_error?: string }> }) {
  const viewer = await getViewer();
  if (!viewer) redirect('/sign-in?next=/dashboard/settings');
  const { link_error } = await searchParams;
  const [github, leetcode] = await Promise.all([syncGithub(viewer.userId), leetcodeStatus(viewer.userId)]);
  const notice = (link_error && (LINK_ERRORS[link_error] ?? 'GitHub linking did not finish. Try again.')) || github.notice;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Linked accounts used to verify your challenges.</p>
      </div>
      <GithubCard account={github.account} locked={github.locked} notice={notice} />
      <LeetcodeCard status={leetcode} />
      <Card>
        <CardHeader>
          <CardTitle>Wallet</CardTitle>
          <CardDescription>Stakes, payouts and wallet sign-in.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link className="text-sm underline underline-offset-4" href="/dashboard/wallet">
            Manage wallets
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
