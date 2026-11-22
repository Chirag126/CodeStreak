'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useToast } from '@/components/feedback/toaster';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { respondAction } from '@/app/dashboard/invite-actions';

export interface MyInvite {
  id: string;
  title: string;
  address: string;
  from: string;
}

export function MyInvites({ invites }: { invites: MyInvite[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();

  function answer(invite: MyInvite, a: 'accept' | 'decline') {
    start(async () => {
      const r = await respondAction(invite.id, a);
      if (!r.ok) return toast({ kind: 'error', title: 'Could not answer', message: r.error });
      if (a === 'accept') {
        toast({ kind: 'success', title: 'Invitation accepted', message: 'Join with your stake to take part.', href: `/challenges/${invite.address}`, hrefLabel: 'Open group' });
      } else {
        toast({ kind: 'info', title: 'Invitation declined' });
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invitations</CardTitle>
        <CardDescription>Private groups your friends invited you to.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <Link href={`/challenges/${i.address}`} className="font-medium underline-offset-4 hover:underline">
                {i.title}
              </Link>
              <span className="text-xs text-muted-foreground">from {i.from}</span>
              <span className="ml-auto flex gap-2">
                <Button size="sm" onClick={() => answer(i, 'accept')} disabled={busy}>
                  Accept
                </Button>
                <Button size="sm" variant="ghost" onClick={() => answer(i, 'decline')} disabled={busy}>
                  Decline
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
