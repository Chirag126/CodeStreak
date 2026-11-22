import type { Metadata } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { safeNext } from '@/lib/auth/routes';
import { ConfirmSession } from './confirm-session';

export const metadata: Metadata = { title: 'Signing in', robots: { index: false, follow: false } };

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
      <Card>
        <CardHeader>
          <CardTitle>Signing in to CodeStreak</CardTitle>
        </CardHeader>
        <CardContent>
          <ConfirmSession next={safeNext(next)} />
        </CardContent>
      </Card>
    </div>
  );
}
