'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { moderateAction, type AdminAction } from '@/app/admin/actions';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface Spec {
  label: string;
  help: string;
  fields?: ('hours' | 'permanent' | 'public_reason' | 'restrictions' | 'flag' | 'body' | 'display_name' | 'username' | 'bio' | 'avatar_url' | 'days' | 'confirm')[];
  irreversible?: boolean;
  danger?: boolean;
}

const SPECS: Partial<Record<AdminAction, Spec>> = {
  warn: { label: 'Issue a warning', help: 'Counts a warning and notifies the user with your reason.' },
  suspend: { label: 'Suspend', help: 'Blocks joining, creating, sponsoring and Shields. The user can still sign in to read the reason and appeal.', fields: ['hours', 'permanent', 'public_reason'] },
  ban: { label: 'Ban permanently', help: 'Like a suspension with no end. Reversible only by reinstating.', fields: ['public_reason', 'confirm'], irreversible: true, danger: true },
  reinstate: { label: 'Reinstate', help: 'Back to active: clears suspension, ban or a scheduled deletion.' },
  review: { label: 'Place under review', help: 'Marks the account for review. The user can keep using CodeStreak.' },
  restrict: { label: 'Restrict features', help: 'Turn individual features off (or back on).', fields: ['restrictions', 'public_reason'] },
  require_reverify: { label: 'Require re-verification', help: 'Blocks new challenges until the user re-links GitHub / LeetCode (cleared automatically on re-link).' },
  flag_add: { label: 'Add a flag', help: 'An internal label, e.g. suspected_cheating. Never shown to the user.', fields: ['flag'] },
  flag_remove: { label: 'Remove a flag', help: 'Clears an active internal flag.', fields: ['flag'] },
  note_add: { label: 'Add an internal note', help: 'Private to the Control Center.', fields: ['body'] },
  edit_profile: { label: 'Edit profile', help: 'Only application-managed fields. Leave a field empty to keep it; a username change needs the current username typed below.', fields: ['display_name', 'username', 'bio', 'avatar_url', 'confirm'] },
  schedule_deletion: { label: 'Schedule account deletion', help: 'Starts a grace period (the user can appeal). Personal data is removed only when you finalize after it ends.', fields: ['days', 'confirm'], irreversible: true, danger: true },
  cancel_deletion: { label: 'Cancel scheduled deletion', help: 'Keeps the account.' },
  finalize_deletion: { label: 'Finalize deletion', help: 'Removes profile data, linked accounts and wallets and locks the login. On-chain history and financial records stay.', fields: ['confirm'], irreversible: true, danger: true },
};

const RESTRICTIONS = [
  { key: 'challenges', label: 'Challenge participation' },
  { key: 'groups', label: 'Group creation & invites' },
  { key: 'sponsorship', label: 'Sponsorship' },
  { key: 'profile_hidden', label: 'Hide public profile' },
];

const input = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';

export function ModerationPanel({ userId, username, current, flags, actions = Object.keys(SPECS) as AdminAction[], triggerLabel, triggerVariant = 'outline' }: {
  userId: string;
  username: string | null;
  current: { restrictions: string[] };
  flags: string[];
  actions?: AdminAction[];
  triggerLabel?: string;
  triggerVariant?: 'outline' | 'default' | 'secondary' | 'ghost';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<AdminAction>(actions[0]!);
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [f, setF] = useState<Record<string, string>>({});
  const [permanent, setPermanent] = useState(false);
  const [restrict, setRestrict] = useState<Record<string, boolean>>(() => Object.fromEntries(RESTRICTIONS.map((r) => [r.key, current.restrictions.includes(r.key)])));
  const [stage, setStage] = useState<'form' | 'confirm'>('form');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const spec = SPECS[action]!;
  const has = (k: NonNullable<Spec['fields']>[number]) => spec.fields?.includes(k) ?? false;

  const params = useMemo(() => {
    const p: Record<string, unknown> = { notify };
    if (has('hours')) {
      if (permanent) p.permanent = true;
      else p.hours = Number(f.hours || 24);
    }
    if (has('public_reason') && f.public_reason) p.public_reason = f.public_reason;
    if (has('restrictions')) {
      p.add = RESTRICTIONS.filter((r) => restrict[r.key] && !current.restrictions.includes(r.key)).map((r) => r.key);
      p.remove = RESTRICTIONS.filter((r) => !restrict[r.key] && current.restrictions.includes(r.key)).map((r) => r.key);
    }
    if (has('flag')) p.flag = f.flag ?? '';
    if (has('body')) p.body = f.body ?? '';
    if (action === 'edit_profile') {
      for (const k of ['display_name', 'username', 'bio', 'avatar_url'] as const) if ((f[k] ?? '') !== '') p[k] = f[k];
    }
    if (has('days')) p.days = Number(f.days || 7);
    if (has('confirm') && f.confirm) p.confirm = f.confirm;
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, f, notify, permanent, restrict, current.restrictions]);

  const needsConfirm = spec.irreversible || (action === 'suspend' && permanent);
  const reasonOk = reason.trim().length >= 5;

  function reset(next: AdminAction) {
    setAction(next);
    setF({});
    setPermanent(false);
    setStage('form');
    setResult(null);
    setRequestId(crypto.randomUUID());
  }

  function submit() {
    start(async () => {
      const res = await moderateAction({ target: userId, action, reason, params, requestId });
      if (res.ok) {
        setResult({ ok: true, text: res.message });
        setReason('');
        setRequestId(crypto.randomUUID()); // the next action is a new request
        setStage('form');
        router.refresh();
      } else {
        setResult({ ok: false, text: res.error });
        setStage('form');
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset(action);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant={triggerVariant}>
          {triggerLabel ?? 'Take action'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{stage === 'confirm' ? 'Confirm' : 'Moderate'} @{username ?? 'user'}</DialogTitle>
          <DialogDescription>{stage === 'confirm' ? 'This is irreversible or high impact. Check the summary.' : 'Every action needs a reason and is written to the audit log.'}</DialogDescription>
        </DialogHeader>

        {stage === 'form' ? (
          <div className="space-y-3 text-sm">
            {actions.length > 1 && (
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Action</span>
                <select className={input} value={action} onChange={(e) => reset(e.target.value as AdminAction)}>
                  {actions.map((a) => (
                    <option key={a} value={a}>
                      {SPECS[a]?.label ?? a}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="text-xs text-muted-foreground">{spec.help}</p>

            {has('hours') && (
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">Duration</span>
                  <select className={input} disabled={permanent} value={f.hours ?? '24'} onChange={(e) => setF({ ...f, hours: e.target.value })}>
                    {[
                      ['1', '1 hour'],
                      ['24', '1 day'],
                      ['72', '3 days'],
                      ['168', '7 days'],
                      ['720', '30 days'],
                    ].map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 pb-2">
                  <input type="checkbox" checked={permanent} onChange={(e) => setPermanent(e.target.checked)} /> Permanent
                </label>
              </div>
            )}
            {has('restrictions') && (
              <fieldset className="grid grid-cols-2 gap-2">
                {RESTRICTIONS.map((r) => (
                  <label key={r.key} className="flex items-center gap-2">
                    <input type="checkbox" checked={restrict[r.key]} onChange={(e) => setRestrict({ ...restrict, [r.key]: e.target.checked })} />
                    {r.label}
                  </label>
                ))}
              </fieldset>
            )}
            {has('flag') &&
              (action === 'flag_remove' ? (
                <select className={input} value={f.flag ?? ''} onChange={(e) => setF({ ...f, flag: e.target.value })}>
                  <option value="">Choose a flag…</option>
                  {flags.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              ) : (
                <input className={input} placeholder="flag, e.g. suspected_cheating" value={f.flag ?? ''} onChange={(e) => setF({ ...f, flag: e.target.value })} maxLength={32} />
              ))}
            {has('body') && <textarea className={cn(input, 'h-24 py-2')} placeholder="Internal note" value={f.body ?? ''} onChange={(e) => setF({ ...f, body: e.target.value })} maxLength={2000} />}
            {action === 'edit_profile' &&
              (['display_name', 'username', 'bio', 'avatar_url'] as const).map((k) => (
                <input key={k} className={input} placeholder={`New ${k.replace('_', ' ')} (empty = keep)`} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} maxLength={k === 'bio' ? 280 : k === 'avatar_url' ? 500 : 50} />
              ))}
            {has('days') && (
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Grace period (days, 1–30)</span>
                <input className={input} type="number" min={1} max={30} value={f.days ?? '7'} onChange={(e) => setF({ ...f, days: e.target.value })} />
              </label>
            )}
            {has('public_reason') && <input className={input} placeholder="Message the user sees (optional)" value={f.public_reason ?? ''} onChange={(e) => setF({ ...f, public_reason: e.target.value })} maxLength={500} />}
            {(has('confirm') || (action === 'suspend' && permanent)) && (
              <input className={input} placeholder={`Type ${username ?? 'the public ID'} to confirm`} value={f.confirm ?? ''} onChange={(e) => setF({ ...f, confirm: e.target.value })} autoComplete="off" />
            )}
            <textarea className={cn(input, 'h-20 py-2')} placeholder="Reason (required, recorded in the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify the user
            </label>
            {result && <p className={cn('text-sm', result.ok ? 'text-success' : 'text-destructive-text')}>{result.text}</p>}
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <p>
              <strong>{spec.label}</strong> for <strong>@{username}</strong>.
            </p>
            <p className="text-muted-foreground">Reason: {reason}</p>
          </div>
        )}

        <DialogFooter>
          {stage === 'confirm' && (
            <Button variant="ghost" onClick={() => setStage('form')} disabled={busy}>
              Back
            </Button>
          )}
          <Button
            variant={spec.danger ? 'destructive' : 'default'}
            disabled={!reasonOk || busy}
            loading={busy}
            onClick={() => (needsConfirm && stage === 'form' ? setStage('confirm') : submit())}
          >
            {needsConfirm && stage === 'form' ? 'Review' : spec.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Decide an appeal or a report (smaller, single-purpose forms). */
export function DecisionButton({ userId, username, action, params, label, variant = 'outline' }: { userId: string; username: string | null; action: 'appeal_decide' | 'report_set'; params: Record<string, unknown>; label: string; variant?: 'outline' | 'default' | 'destructive' }) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [requestId] = useState(() => crypto.randomUUID());
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant={variant}>
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>@{username ?? 'user'} · recorded in the audit log.</DialogDescription>
        </DialogHeader>
        <textarea className={cn(input, 'h-20 py-2')} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
        <DialogFooter>
          <Button
            disabled={reason.trim().length < 5 || busy}
            loading={busy}
            onClick={() =>
              start(async () => {
                const res = await moderateAction({ target: userId, action, reason, params: { ...params, note: reason, resolution: reason }, requestId });
                setMsg(res.ok ? res.message : res.error);
                if (res.ok) router.refresh();
              })
            }
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
