'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { chooseRepoAction } from '@/app/challenges/[address]/repo-actions';
import { useToast } from '@/components/feedback/toaster';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RepoPicker, type PickerRepo } from './repo-picker';

type Choice = { fullName: string; repoId: number; effectiveFrom: string };

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

/**
 * Individual repository mode on the challenge page: the player's verification repository, a picker
 * to choose or change it while that is allowed, and the rules in plain words.
 */
export function RepoChoiceCard({
  challenge,
  current,
  upcoming,
  locked,
  started,
  canChange,
  allowForks,
  member,
}: {
  challenge: string;
  current: Choice | null;
  upcoming: Choice | null;
  locked: boolean;
  /** Day 1 has started (a change then applies from the next day). */
  started: boolean;
  /** Joining open (not a member yet) or the challenge still running. */
  canChange: boolean;
  allowForks: boolean;
  member: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(!current && canChange);
  const [pending, setPending] = useState<PickerRepo | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!pending) return;
    setSaving(true);
    setError(null);
    const r = await chooseRepoAction({ challenge, repoId: pending.id });
    setSaving(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast({
      kind: 'success',
      title: r.changed ? 'Repository saved' : 'No change',
      message: started ? `${r.fullName} counts from ${when(r.effectiveFrom)}.` : `${r.fullName} counts from day 1.`,
    });
    setOpen(false);
    setPending(null);
    router.refresh();
  }

  const shown = pending ? [pending.fullName] : upcoming ? [upcoming.fullName] : current ? [current.fullName] : [];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Your verification repository</CardTitle>
          {current && <Badge variant="success">Checked on GitHub ✓</Badge>}
          {locked && <Badge variant="outline">Locked</Badge>}
        </div>
        <CardDescription>Your GitHub pushes for this challenge count only in this repository.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {current ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
            <a className="font-mono underline-offset-4 hover:underline" href={`https://github.com/${current.fullName}`} target="_blank" rel="noreferrer">
              {current.fullName.replace('/', ' / ')}
            </a>
            {canChange && !locked && !open && (
              <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                Change repository
              </Button>
            )}
          </div>
        ) : (
          <p role="status" className="rounded-lg border border-warning-400/40 bg-warning-400/10 p-3">
            {member
              ? 'You haven’t chosen a repository yet, so none of your pushes can count. Choose one now.'
              : 'Choose the repository you’ll code in for this challenge. You need one to join.'}
          </p>
        )}
        {upcoming && (
          <p className="text-muted-foreground">
            From {when(upcoming.effectiveFrom)}: <span className="font-mono">{upcoming.fullName}</span> (today still counts {current?.fullName}).
          </p>
        )}

        {open && canChange && !locked && (
          <div className="space-y-3">
            <RepoPicker mode="single" selected={shown} allowForks={allowForks} disabled={saving} onToggle={(r) => setPending(r)} />
            {error && (
              <p role="alert" className="text-destructive-text">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void save()} loading={saving} disabled={!pending || pending.fullName === (upcoming ?? current)?.fullName}>
                {pending ? `Use ${pending.fullName}` : 'Pick a repository above'}
              </Button>
              {current && (
                <Button variant="ghost" onClick={() => { setOpen(false); setPending(null); setError(null); }} disabled={saving}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}

        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li>It must be a public repository on your linked GitHub account{allowForks ? '' : ', not a fork'}. Each commit must still be written and pushed by you.</li>
          <li>You can change it until your first verified day; after that it is locked to protect your streak.</li>
          <li>Once the challenge has started, a change applies from the next day. Days already under way never change.</li>
          <li>Deleting the repository or making it private means no push can count, so those days fail.</li>
        </ul>
      </CardContent>
    </Card>
  );
}
