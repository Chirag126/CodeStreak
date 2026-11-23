'use client';

import { formatWait } from '@codestreak/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CopyButton } from '@/components/auth/copy-button';
import { useToast } from '@/components/feedback/toaster';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCountdown } from '@/app/sign-in/use-countdown';
import type { LeetcodeStatus } from '@/lib/accounts/leetcode';
import { cancelLeetcodeAction, startLeetcodeAction, unlinkLeetcodeAction, verifyLeetcodeAction } from './actions';

/**
 * LeetCode has no "sign in with": ownership is proved by putting a one-time code in a public profile
 * field (e.g. ReadMe), which only the owner can edit. CodeStreak reads the public profile live to confirm.
 */
export function LeetcodeCard({ status }: { status: LeetcodeStatus }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [handle, setHandle] = useState(status.pending?.handle ?? '');
  const [error, setError] = useState<string | null>(null);
  const expires = useCountdown(status.pending ? Date.parse(status.pending.expiresAt) : undefined);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? 'Something went wrong.');
      else if (success) toast({ kind: 'success', title: success });
      router.refresh();
    });

  const pending = status.pending && expires > 0 ? status.pending : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>LeetCode</CardTitle>
          {status.account ? <Badge variant="success">Linked</Badge> : <Badge variant="outline">Not linked</Badge>}
          {status.locked && status.account && <Badge variant="warning">Locked during your challenge</Badge>}
        </div>
        <CardDescription>Used to verify accepted solutions. CodeStreak only reads your public LeetCode profile; it never asks for your password.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.account ? (
          <>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Account</dt>
                <dd>
                  <a className="underline underline-offset-4" href={`https://leetcode.com/u/${status.account.handle}/`} target="_blank" rel="noreferrer">
                    {status.account.handle} ↗
                  </a>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Linked</dt>
                <dd>{new Date(status.account.linkedAt).toUTCString().slice(5, 16)}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">Linked. You can remove the verification code from your LeetCode profile (ReadMe) now.</p>
            <Button variant="outline" disabled={busy || status.locked} onClick={() => run(unlinkLeetcodeAction, 'LeetCode unlinked')}>
              Unlink LeetCode
            </Button>
            {status.locked && <p className="text-xs text-muted-foreground">To keep results fair, it can&apos;t be changed or unlinked until your open challenges end.</p>}
          </>
        ) : pending ? (
          <div className="space-y-3">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              <li>
                Copy this code:{' '}
                <span className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 font-mono">
                  {pending.code}
                  <CopyButton value={pending.code} label="Copy code" />
                </span>
              </li>
              <li>
                Open{' '}
                <a className="underline underline-offset-4" href="https://leetcode.com/settings/profile/" target="_blank" rel="noreferrer">
                  LeetCode → Settings → Profile ↗
                </a>{' '}
                (signed in as <span className="font-mono">{pending.handle}</span>). Paste it into any field shown on your public profile: the short bio under your name (top of the page) or <strong>ReadMe</strong>. Save.
              </li>
              <li>
                Check it shows on{' '}
                <a className="underline underline-offset-4" href={`https://leetcode.com/u/${pending.handle}/`} target="_blank" rel="noreferrer">
                  your public profile ↗
                </a>
                , then press Verify. CodeStreak looks for the code anywhere on that page.
              </li>
            </ol>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => run(verifyLeetcodeAction, 'LeetCode linked')} loading={busy}>
                Verify
              </Button>
              <Button variant="ghost" onClick={() => run(cancelLeetcodeAction)} disabled={busy}>
                Use a different username
              </Button>
              <span className="text-xs text-muted-foreground">
                Code expires in {formatWait(expires)} · {pending.attemptsLeft} attempt{pending.attemptsLeft === 1 ? '' : 's'} left
              </span>
            </div>
          </div>
        ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => startLeetcodeAction(handle));
            }}
          >
            <div className="min-w-56 flex-1 space-y-2">
              <Label htmlFor="leetcode-handle">Your LeetCode username</Label>
              <Input id="leetcode-handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="username or leetcode.com/u/username" spellCheck={false} autoCapitalize="none" />
            </div>
            <Button type="submit" loading={busy} disabled={!handle.trim()}>
              Get a code
            </Button>
          </form>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive-text">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
