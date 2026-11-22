'use client';

import { useState, useTransition } from 'react';
import { CopyButton } from '@/components/auth/copy-button';
import { useToast } from '@/components/feedback/toaster';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createSponsorLinkAction, revokeSponsorLinkAction } from '@/app/challenges/[address]/sponsor-actions';

/** Creator-only, private groups: a link that lets outsiders sponsor without seeing the members. */
export function SponsorLinkPanel({ challengeId, hasLink }: { challengeId: string; hasLink: boolean }) {
  const toast = useToast();
  const [busy, start] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [active, setActive] = useState(hasLink);

  function create() {
    start(async () => {
      const r = await createSponsorLinkAction(challengeId);
      if (!r.ok) return toast({ kind: 'error', title: 'No link created', message: r.error });
      setUrl(r.url);
      setActive(true);
    });
  }

  function revoke() {
    start(async () => {
      const r = await revokeSponsorLinkAction(challengeId);
      if (!r.ok) return toast({ kind: 'error', title: 'Not turned off', message: r.error });
      setUrl(null);
      setActive(false);
      toast({ kind: 'info', title: 'Sponsor link turned off' });
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Private sponsor link</CardTitle>
        <CardDescription>
          People with this link can sponsor the group and see its title, pool and sponsors, but not its members. Without it, outsiders can&apos;t sponsor a private group.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={create} loading={busy}>
            {active ? 'Make a new link' : 'Create sponsor link'}
          </Button>
          {active && (
            <Button variant="ghost" onClick={revoke} disabled={busy}>
              Turn off
            </Button>
          )}
        </div>
        {active && !url && <p className="text-xs text-muted-foreground">A link is active. For safety it can&apos;t be shown again: make a new one to copy it (the old one stops working).</p>}
        {url && (
          <div className="space-y-1 rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{url}</code>
              <CopyButton value={url} label="Copy sponsor link" />
            </div>
            <p className="text-xs text-muted-foreground">Shown only now: CodeStreak keeps just a fingerprint of it.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
