import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { safeNext, SIGN_IN_PATH } from '@/lib/auth/routes';
import { getViewer } from '@/lib/supabase/server';
import { UsernameForm } from './username-form';

export const metadata: Metadata = { title: 'Choose a username' };

export default async function UsernamePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const viewer = await getViewer();
  if (!viewer) redirect(SIGN_IN_PATH);
  const { next } = await searchParams;
  const target = safeNext(next);
  if (viewer.username) redirect(target);

  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
      <Card>
        <CardHeader>
          <CardTitle>Pick your username</CardTitle>
          <CardDescription>
            Friends invite you to private groups with your public ID{' '}
            <span className="font-mono text-foreground">{viewer.publicId}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UsernameForm next={target} />
        </CardContent>
      </Card>
    </div>
  );
}
