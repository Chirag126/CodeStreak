'use client';

import { Flag } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { reportUserAction, type ReportReason } from './actions';

const REASONS: [ReportReason, string][] = [
  ['cheating', 'Cheating or faked activity'],
  ['harassment', 'Harassment'],
  ['spam', 'Spam'],
  ['impersonation', 'Impersonation'],
  ['inappropriate', 'Inappropriate profile'],
  ['other', 'Something else'],
];

export function ReportButton({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>('cheating');
  const [details, setDetails] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setMsg(null); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={`Report @${username}`}>
          <Flag className="size-4" aria-hidden />
          <span className="hidden sm:inline">Report</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report @{username}</DialogTitle>
          <DialogDescription>Reports are private. The CodeStreak team reviews each one.</DialogDescription>
        </DialogHeader>
        {msg?.ok ? (
          <p className="text-sm text-success">{msg.text}</p>
        ) : (
          <div className="space-y-3">
            <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm" value={reason} onChange={(e) => setReason(e.target.value as ReportReason)} aria-label="Reason">
              {REASONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <textarea className="h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Details (optional)" maxLength={1000} value={details} onChange={(e) => setDetails(e.target.value)} />
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                loading={busy}
                onClick={() =>
                  start(async () => {
                    const r = await reportUserAction(username, reason, details);
                    setMsg(r.ok ? { ok: true, text: 'Thanks, your report was sent.' } : { ok: false, text: r.error });
                  })
                }
              >
                Send report
              </Button>
              {msg && !msg.ok && <span className="text-sm text-destructive-text">{msg.text}</span>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
