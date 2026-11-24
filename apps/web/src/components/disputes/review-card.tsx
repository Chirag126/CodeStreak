'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { reviewDisputeAction } from '@/app/admin/disputes/actions';
import { useToast } from '@/components/feedback/toaster';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

/** Approve / reject with a note to the player (admins only; the database checks again). */
export function ReviewForm({ id, windowOpen }: { id: string; windowOpen: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [choice, setChoice] = useState<boolean | null>(null);

  const decide = (approve: boolean) =>
    start(async () => {
      setChoice(approve);
      setError(null);
      const r = await reviewDisputeAction({ id, approve, note });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      toast({
        kind: 'success',
        title: r.status === 'approved' ? 'Approved' : r.status === 'expired' ? 'Too late: the window closed' : 'Rejected',
        message: r.status === 'approved' ? 'The worker upgrades the day on-chain within a minute.' : 'The player sees your note.',
      });
      router.refresh();
    });

  return (
    <div className="space-y-2">
      <Label htmlFor={`note-${id}`}>Note to the player</Label>
      <textarea
        id={`note-${id}`}
        className="min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
        value={note}
        maxLength={1000}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What you checked and why you decided this way."
      />
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => decide(true)} loading={pending && choice === true} disabled={pending || !windowOpen || note.trim().length < 5}>
          Approve · verify on-chain
        </Button>
        <Button size="sm" variant="outline" onClick={() => decide(false)} loading={pending && choice === false} disabled={pending || note.trim().length < 5}>
          Reject
        </Button>
      </div>
      {!windowOpen && <p className="text-xs text-muted-foreground">The dispute window has closed: it can only be rejected.</p>}
    </div>
  );
}
