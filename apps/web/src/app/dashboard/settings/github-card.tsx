'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useToast } from '@/components/feedback/toaster';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { unlinkGithubAction } from './actions';

export interface GithubView {
  id: string;
  username: string;
  linkedAt: string;
}

/**
 * Link through Supabase identity linking (GitHub OAuth, read-only public profile), then the server
 * records the numeric GitHub ID. Unlinking: the server first (it may refuse while you are in an
 * open challenge), then the Supabase identity.
 */
export function GithubCard({ account, locked, notice }: { account: GithubView | null; locked: boolean; notice: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function link() {
    setError(null);
    start(async () => {
      const next = '/dashboard/settings?linked=github';
      const { error: e } = await createSupabaseBrowserClient().auth.linkIdentity({
        provider: 'github',
        options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      });
      if (e) setError(/manual linking/i.test(e.message) ? 'GitHub linking is not enabled in Supabase yet (Allow manual linking).' : 'Could not start GitHub linking. Try again.');
    });
  }

  function unlink() {
    setError(null);
    start(async () => {
      const r = await unlinkGithubAction();
      if (!r.ok) return setError(r.error);
      const supabase = createSupabaseBrowserClient();
      const { data } = await supabase.auth.getUserIdentities();
      const identity = data?.identities.find((i) => i.provider === 'github');
      if (identity) await supabase.auth.unlinkIdentity(identity);
      toast({ kind: 'info', title: 'GitHub unlinked' });
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>GitHub</CardTitle>
          {account ? <Badge variant="success">Linked</Badge> : <Badge variant="outline">Not linked</Badge>}
          {locked && account && <Badge variant="warning">Locked during your challenge</Badge>}
        </div>
        <CardDescription>Used to verify your coding days. CodeStreak reads only your public activity; it never gets access to your code or private repos.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {account ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Account</dt>
              <dd>
                <a className="underline underline-offset-4" href={`https://github.com/${account.username}`} target="_blank" rel="noreferrer">
                  @{account.username} ↗
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">GitHub ID</dt>
              <dd className="font-mono">{account.id}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Linked</dt>
              <dd>{new Date(account.linkedAt).toUTCString().slice(5, 16)}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Link GitHub to join challenges that count GitHub pushes.</p>
        )}
        {notice && (
          <p className="text-sm text-warning" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive-text" role="alert">
            {error}
          </p>
        )}
        {account ? (
          <Button variant="ghost" onClick={unlink} disabled={busy || locked} title={locked ? 'You can unlink after your open challenges end.' : undefined}>
            Unlink GitHub
          </Button>
        ) : (
          <Button onClick={link} loading={busy}>
            Link GitHub
          </Button>
        )}
        {locked && account && <p className="text-xs text-muted-foreground">To keep results fair, your GitHub can&apos;t be changed or unlinked until your open challenges end.</p>}
      </CardContent>
    </Card>
  );
}
