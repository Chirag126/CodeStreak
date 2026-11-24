import { Badge } from '@/components/ui/badge';
import { explorerTxUrl } from '@/components/tx/tx-stepper';
import type { DisputeStatus, Ticket } from '@/lib/disputes/load';

export const STATUS: Record<DisputeStatus, { label: string; variant: 'accent' | 'warning' | 'success' | 'danger' | 'outline'; help: string }> = {
  open: { label: 'Waiting for review', variant: 'warning', help: 'An admin will look at it before the dispute window closes.' },
  approved: { label: 'Approved · recording', variant: 'accent', help: 'Approved. The day is being upgraded on-chain (about a minute).' },
  rejected: { label: 'Rejected', variant: 'danger', help: 'The result stays as recorded.' },
  resolved: { label: 'Verified on-chain', variant: 'success', help: 'The day is now verified on-chain.' },
  expired: { label: 'Expired', variant: 'outline', help: 'The dispute window closed before the upgrade could be recorded.' },
  failed: { label: 'Could not apply', variant: 'danger', help: 'The upgrade could not be recorded.' },
};

const ACTION_LABEL: Record<string, string> = {
  opened: 'You opened the dispute',
  approved: 'An admin approved it',
  rejected: 'An admin rejected it',
  resolved: 'Upgraded on-chain',
  expired: 'Expired',
  failed: 'Could not be applied',
};

/** One ticket with its timeline (the audit trail the player sees). */
export function TicketView({ ticket, showChallenge = false }: { ticket: Ticket; showChallenge?: boolean }) {
  const s = STATUS[ticket.status];
  return (
    <article className="space-y-3 rounded-lg border border-border p-4 text-sm">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">
          {showChallenge && (
            <a className="hover:underline" href={`/challenges/${ticket.challenge.address}`}>
              {ticket.challenge.title} ·{' '}
            </a>
          )}
          Day {ticket.day + 1} <span className="text-muted-foreground">(was {ticket.previousResult === 'failed' ? 'failed' : 'could not verify'})</span>
        </p>
        <Badge variant={s.variant}>{s.label}</Badge>
      </header>
      <p className="whitespace-pre-wrap text-muted-foreground">{ticket.reason}</p>
      {ticket.evidence.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5">
          {ticket.evidence.map((u) => (
            <li key={u}>
              <a className="break-all underline underline-offset-4" href={u} target="_blank" rel="noreferrer nofollow">
                {u}
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{ticket.error ?? s.help}</p>
      <ol aria-label="Timeline" className="space-y-1 border-l border-border pl-3 text-xs">
        {ticket.events.map((e, i) => (
          <li key={`${e.at}-${i}`}>
            <time className="text-muted-foreground" dateTime={e.at}>
              {new Date(e.at).toLocaleString()}
            </time>{' '}
            · {ACTION_LABEL[e.action] ?? e.action}
            {e.note && e.action !== 'opened' && <span className="text-muted-foreground"> — {e.note}</span>}
          </li>
        ))}
      </ol>
      {ticket.resolutionTx && (
        <a className="text-xs underline underline-offset-4" href={explorerTxUrl(ticket.resolutionTx)} target="_blank" rel="noreferrer">
          View the on-chain upgrade
        </a>
      )}
    </article>
  );
}
