import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { disputableDays, myTickets } from '@/lib/disputes/load';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { DisputeForm } from './dispute-form';
import { TicketView } from './ticket-view';

/** Challenge page: the viewer's disputes for this challenge, and the form while the window is open. */
export async function DisputePanel({ address, membershipId, profileId, disputeEndMs }: { address: string; membershipId: string; profileId: string; disputeEndMs: number }) {
  const supabase = await createSupabaseServerClient();
  const [tickets, { open: windowOpen, days }] = await Promise.all([myTickets(supabase, profileId, membershipId), disputableDays(supabase, membershipId, disputeEndMs)]);
  const live = new Set(tickets.filter((t) => t.status === 'open' || t.status === 'approved').map((t) => t.day));
  const open = days.filter((d) => !live.has(d.day));
  if (!tickets.length && !open.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Disputes</CardTitle>
        <CardDescription>
          Think a recorded day is wrong? Open a dispute before the dispute window closes. Only you and CodeStreak admins can see it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {open.length > 0 ? (
          <DisputeForm address={address} membershipId={membershipId} days={open} closesAt={new Date(disputeEndMs).toISOString()} />
        ) : !windowOpen ? (
          <p className="text-sm text-muted-foreground">The dispute window has closed.</p>
        ) : null}
        {tickets.map((t) => (
          <TicketView key={t.id} ticket={t} />
        ))}
      </CardContent>
    </Card>
  );
}
