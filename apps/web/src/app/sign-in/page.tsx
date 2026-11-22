import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { safeNext } from '@/lib/auth/routes';
import { SignInForm } from './sign-in-form';
import { WalletSignIn } from './wallet-sign-in';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <div className="mx-auto flex max-w-md flex-col px-4 py-16 sm:px-6">
      <Card>
        <CardHeader>
          <CardTitle>Sign in to CodeStreak</CardTitle>
          <CardDescription>We&apos;ll email you a one-time sign-in link, or sign in with a wallet you linked.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <SignInForm next={safeNext(next)} linkError={error === 'link'} />
          <WalletSignIn next={safeNext(next)} />
        </CardContent>
      </Card>
    </div>
  );
}
