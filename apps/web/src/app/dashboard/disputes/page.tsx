import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { TicketView } from '@/components/disputes/ticket-view';
import { RefreshOnFocus } from '@/components/motion/refresh-on-focus';
import { SIGN_IN_PATH, USERNAME_PATH } from '@/lib/auth/routes';
import { myTickets } from '@/lib/disputes/load';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Disputes' };
export const dynamic = 'force-dynamic';

export default async function MyDisputesPage() {
  const viewer = await getViewer();
  if (!viewer) redirect(SIGN_IN_PATH);
  if (!viewer.username) redirect(USERNAME_PATH);
  const supabase = await createSupabaseServerClient();
  const [tickets, { data: isAdmin }] = await Promise.all([myTickets(supabase, viewer.userId), supabase.rpc('am_i_admin')]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6">
      <RefreshOnFocus />
      <div className="space-y-2">
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
          ← Dashboard
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Your disputes</h1>
        <p className="text-sm text-muted-foreground">
          Open a dispute from the challenge page while its dispute window is open. Each ticket shows its full timeline. Only you and CodeStreak admins can see
          your tickets.
        </p>
        {isAdmin === true && (
          <Link href="/admin/disputes" className="text-sm underline underline-offset-4">
            Admin: review disputes
          </Link>
        )}
      </div>
      {tickets.length === 0 ? <p className="text-sm text-muted-foreground">No disputes yet.</p> : tickets.map((t) => <TicketView key={t.id} ticket={t} showChallenge />)}
    </div>
  );
}
