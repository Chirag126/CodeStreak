'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Any server or render error inside the app. The header and navigation stay (this renders inside
 * the root layout), so one broken page never leaves the user stuck.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-16 sm:px-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">This page hit a problem</CardTitle>
          <CardDescription>
            Something failed while loading it, often because Solana devnet is busy for a moment. Your funds and records are not affected: everything lives
            on-chain and is re-read on the next load.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={reset}>Try again</Button>
            <Button asChild variant="outline">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/challenges">Challenges</Link>
            </Button>
          </div>
          {error.digest && <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
