'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { openDisputeAction } from '@/app/challenges/[address]/dispute-actions';
import { useToast } from '@/components/feedback/toaster';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { DisputableDay } from '@/lib/disputes/load';

/** "Dispute a day": pick one of your recorded failed / could-not-verify days, explain, add links. */
export function DisputeForm({ address, membershipId, days, closesAt }: { address: string; membershipId: string; days: DisputableDay[]; closesAt: string }) {
  const router = useRouter();
  const toast = useToast();
  const [day, setDay] = useState(days[0]?.day ?? 0);
  const [reason, setReason] = useState('');
  const [links, setLinks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setError(null);
      const evidence = links
        .split(/\s+/)
        .map((l) => l.trim())
        .filter(Boolean);
      const r = await openDisputeAction({ address, membershipId, day, reason, evidence });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast({ kind: 'success', title: 'Dispute opened', message: `Day ${day + 1} is waiting for review. You can follow it below and in Dashboard → Disputes.` });
      setReason('');
      setLinks('');
      router.refresh();
    });

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="dispute-day">Day</Label>
        <select
          id="dispute-day"
          className="h-10 w-full rounded-md border border-input bg-transparent px-3 text-sm"
          value={day}
          onChange={(e) => setDay(Number(e.target.value))}
        >
          {days.map((d) => (
            <option key={d.day} value={d.day}>
              Day {d.day + 1} — {d.result === 'failed' ? 'failed' : 'could not verify'}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dispute-reason">What happened?</Label>
        <textarea
          id="dispute-reason"
          className="min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          value={reason}
          maxLength={2000}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. I pushed a 40-line commit to my repo at 21:10, but it was not counted."
        />
        <p className="text-xs text-muted-foreground">{reason.trim().length}/2000 · at least 20 characters</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="dispute-links">Evidence links (optional, up to 5, https://)</Label>
        <Input id="dispute-links" value={links} onChange={(e) => setLinks(e.target.value)} placeholder="https://github.com/you/repo/commit/…" />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" loading={pending} disabled={pending || reason.trim().length < 20}>
          Open dispute
        </Button>
        <p className="text-xs text-muted-foreground">Disputes close {new Date(closesAt).toLocaleString()}. An approved dispute upgrades the day to verified on-chain.</p>
      </div>
    </form>
  );
}
