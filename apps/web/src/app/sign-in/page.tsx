import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { safeNext } from '@/lib/auth/routes';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
      <Card>
        <CardHeader>
          <CardTitle>Sign in to CodeStreak</CardTitle>
          <CardDescription>We&apos;ll email you a one-time code.</CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm next={safeNext(next)} />
        </CardContent>
      </Card>
    </div>
  );
}
