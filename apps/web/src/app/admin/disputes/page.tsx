import type { Metadata } from 'next';
import { utcAndIst } from '@codestreak/shared';
import { notFound, redirect } from 'next/navigation';
import { ReviewForm } from '@/components/disputes/review-card';
import { STATUS, TicketView } from '@/components/disputes/ticket-view';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SIGN_IN_PATH } from '@/lib/auth/routes';
import { adminQueue, type AdminTicket } from '@/lib/disputes/load';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Disputes · Admin', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** Admins only. Everyone else gets a plain 404: the page does not reveal that it exists. */
export default async function AdminDisputesPage() {
  const viewer = await getViewer();
  if (!viewer) redirect(SIGN_IN_PATH);
  const queue = await adminQueue(await createSupabaseServerClient());
  if (queue === null) notFound();

  const open = queue.filter((t) => t.status === 'open');
  const rest = queue.filter((t) => t.status !== 'open');
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-12 sm:px-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">Dispute review</h1>
        <p className="text-sm text-muted-foreground">
          {open.length} waiting · approving upgrades the day to verified on-chain (signed by the verifier) before the dispute window closes.
        </p>
      </header>
      <section className="space-y-4" aria-label="Waiting for review">
        {open.length === 0 && <p className="text-sm text-muted-foreground">Nothing waiting.</p>}
        {open.map((t) => (
          <AdminTicketCard key={t.id} ticket={t} />
        ))}
      </section>
      {rest.length > 0 && (
        <section className="space-y-3" aria-label="Reviewed">
          <h2 className="text-lg font-semibold">Reviewed</h2>
          {rest.map((t) => (
            <TicketView key={t.id} ticket={t} showChallenge />
          ))}
        </section>
      )}
    </div>
  );
}

function AdminTicketCard({ ticket }: { ticket: AdminTicket }) {
  const providers = (ticket.receipt?.providers as { provider: string; outcome: string; value?: number; goal?: number; confidence?: number }[] | undefined) ?? [];
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">
          <a className="hover:underline" href={`/challenges/${ticket.challenge.address}`}>
            {ticket.challenge.title}
          </a>{' '}
          · day {ticket.day + 1}
        </CardTitle>
        <Badge variant={STATUS[ticket.status].variant}>{STATUS[ticket.status].label}</Badge>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 text-sm">
          <p>
            <span className="text-muted-foreground">Player:</span> {ticket.player.username ? `@${ticket.player.username}` : 'unknown'}{' '}
            <span className="font-mono text-xs">{ticket.player.wallet}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Window closes:</span> {utcAndIst(ticket.disputeEndsAt)}
          </p>
          <div>
            <p className="text-muted-foreground">What the rules engine recorded ({ticket.previousResult}):</p>
            {providers.length ? (
              <ul className="list-disc pl-5">
                {providers.map((p) => (
                  <li key={p.provider}>
                    {p.provider}: {p.outcome}
                    {p.goal != null && ` (${p.value ?? 0}/${p.goal})`}
                    {p.confidence != null && ` · confidence ${p.confidence}`}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No provider details in the receipt.</p>
            )}
          </div>
          <TicketView ticket={ticket} />
        </div>
        <ReviewForm id={ticket.id} windowOpen={ticket.windowOpen} />
      </CardContent>
    </Card>
  );
}
