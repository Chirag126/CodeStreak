'use client';

import { INVITE_LINK_LIMITS } from '@codestreak/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CopyButton } from '@/components/auth/copy-button';
import { useToast } from '@/components/feedback/toaster';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createLinkAction, inviteByIdAction, revokeInviteAction } from '@/app/challenges/[address]/invite-actions';

export interface InviteRow {
  id: string;
  kind: 'person' | 'link';
  label: string;
  status: string;
  detail: string;
}

const STATUS_VARIANT: Record<string, 'primary' | 'success' | 'default' | 'danger' | 'warning'> = {
  pending: 'primary',
  accepted: 'success',
  declined: 'default',
  revoked: 'danger',
  expired: 'warning',
};

/** Creator-only: invite friends by public ID or by an expiring link, and see who was invited. */
const utc = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

export function InvitePanel({ address, invites }: { address: string; invites: InviteRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, start] = useTransition();
  const [publicId, setPublicId] = useState('');
  const [uses, setUses] = useState<number>(INVITE_LINK_LIMITS.defaultMaxUses);
  const [hours, setHours] = useState<number>(INVITE_LINK_LIMITS.defaultHours);
  const [link, setLink] = useState<{ url: string; expiresAt: string; capped: boolean } | null>(null);

  function inviteById() {
    start(async () => {
      const r = await inviteByIdAction(address, publicId);
      if (!r.ok) return toast({ kind: 'error', title: 'Invitation not sent', message: r.error });
      toast({ kind: 'success', title: 'Invitation sent', message: `${r.name} will see it on their dashboard.` });
      setPublicId('');
      router.refresh();
    });
  }

  function makeLink() {
    start(async () => {
      const r = await createLinkAction(address, uses, hours);
      if (!r.ok) return toast({ kind: 'error', title: 'Link not created', message: r.error });
      // Links never outlive the join deadline: say so when that shortened the requested time.
      setLink({ url: r.url, expiresAt: r.expiresAt, capped: Date.parse(r.expiresAt) < Date.now() + hours * 3600_000 - 60_000 });
      router.refresh();
    });
  }

  function revoke(id: string, kind: string) {
    start(async () => {
      const r = await revokeInviteAction(address, id);
      // A turned-off link must not stay on screen ready to copy.
      if (r.ok && kind === 'link') setLink(null);
      toast(r.ok ? { kind: 'info', title: 'Invitation turned off' } : { kind: 'error', title: 'Not revoked', message: r.error });
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite friends</CardTitle>
        <CardDescription>Only invited people can see this group and join it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            inviteById();
          }}
        >
          <div className="min-w-56 flex-1 space-y-2">
            <Label htmlFor="publicId">By public ID</Label>
            <Input id="publicId" value={publicId} onChange={(e) => setPublicId(e.target.value)} placeholder="CS-XXXXXXXX" autoCapitalize="characters" spellCheck={false} />
          </div>
          <Button type="submit" loading={busy} disabled={!publicId.trim()}>
            Invite
          </Button>
        </form>

        <div className="space-y-2">
          <p className="text-sm font-medium">By link</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="uses" className="text-xs">
                Uses
              </Label>
              <select id="uses" value={uses} onChange={(e) => setUses(Number(e.target.value))} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                {[1, 5, 10, 20].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? '1 (single-use)' : n}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="hours" className="text-xs">
                Expires after
              </Label>
              <select id="hours" value={hours} onChange={(e) => setHours(Number(e.target.value))} className="h-9 rounded-md border border-input bg-transparent px-2 text-sm">
                <option value={24}>1 day</option>
                <option value={72}>3 days</option>
                <option value={168}>7 days</option>
              </select>
            </div>
            <Button variant="secondary" onClick={makeLink} loading={busy}>
              Create link
            </Button>
          </div>
          {link && (
            <div className="space-y-1 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{link.url}</code>
                <CopyButton value={link.url} label="Copy invite link" />
              </div>
              <p className="text-xs text-muted-foreground">
                Shown only now: CodeStreak keeps just a fingerprint of it. Expires {utc(link.expiresAt)}
                {link.capped ? ' (when joining closes: a link never outlives the join deadline)' : ''}.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Invitations</p>
          {invites.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-medium">{i.label}</span>
                  <Badge variant={STATUS_VARIANT[i.status] ?? 'default'}>{i.status}</Badge>
                  <span className="text-xs text-muted-foreground">{i.detail}</span>
                  {i.status === 'pending' && (
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => revoke(i.id, i.kind)} disabled={busy}>
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
