import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CopyButton } from '@/components/auth/copy-button';
import { MyInvites } from '@/components/groups/my-invites';
import { Reveal } from '@/components/motion/primitives';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SIGN_IN_PATH, USERNAME_PATH } from '@/lib/auth/routes';
import { listMyInvites } from '@/lib/groups/invites';
import { getViewer } from '@/lib/supabase/server';
import { signOut } from '../sign-in/actions';

export const metadata: Metadata = { title: 'Dashboard' };

// Dashboard shell: identity is real; the sections below are filled in by later phases.
export default async function DashboardPage() {
  const viewer = await getViewer();
  if (!viewer) redirect(SIGN_IN_PATH);
  if (!viewer.username) redirect(USERNAME_PATH);

  const invites = await listMyInvites(viewer.userId);

  const sections: { title: string; body: string; href?: string; cta?: string }[] = [
    { title: 'Your challenges', body: 'Start a public challenge or a private group with friends.', href: '/challenges/new', cta: 'Create a challenge' },
    { title: 'Accounts', body: 'Link GitHub and LeetCode so your activity can be verified.' },
    { title: 'Wallet', body: 'Link Phantom or MetaMask (Solana) and check your devnet balances.', href: '/dashboard/wallet' },
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-12 sm:px-6">
      <Reveal trigger="mount" className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Signed in as {viewer.email}</p>
          <h1 className="text-3xl font-semibold tracking-tight">Hi, {viewer.displayName ?? viewer.username}</h1>
        </div>
        <form action={signOut}>
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </Reveal>

      <Reveal trigger="mount" delay={0.05}>
        <Card>
          <CardHeader>
            <CardTitle>Your public ID</CardTitle>
            <CardDescription>Share it so friends can add you to private groups.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <span className="font-mono text-2xl tracking-wider">{viewer.publicId}</span>
            <CopyButton value={viewer.publicId} label="Copy public ID" />
            <Badge className="ml-auto">@{viewer.username}</Badge>
          </CardContent>
        </Card>
      </Reveal>

      {invites.length > 0 && (
        <Reveal trigger="mount" delay={0.08}>
          <MyInvites invites={invites} />
        </Reveal>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        {sections.map((s, i) => (
          <Reveal key={s.title} trigger="mount" delay={0.1 + i * 0.05}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="text-base">{s.title}</CardTitle>
                <CardDescription>{s.body}</CardDescription>
              </CardHeader>
              <CardContent>
                {s.href ? (
                  <Button asChild size="sm" variant="secondary">
                    <Link href={s.href}>{s.cta ?? 'Open'}</Link>
                  </Button>
                ) : (
                  <Badge variant="outline">Coming soon</Badge>
                )}
              </CardContent>
            </Card>
          </Reveal>
        ))}
      </div>
    </div>
  );
}
