import Link from 'next/link';
import { loadClaimCenter } from '@/lib/claims/service';
import { ClaimRowCard } from './claim-center';

/** The signed-in user's payout for one challenge (challenge page, after it settles or is cancelled). */
export async function MyPayout({ profileId, address }: { profileId: string; address: string }) {
  const { rows } = await loadClaimCenter(profileId, address).catch(() => ({ rows: [] }));
  if (!rows.length) return null;
  return (
    <section aria-label="Your payout" className="space-y-2">
      {rows.map((r) => (
        <ClaimRowCard key={r.role} row={r} />
      ))}
      <p className="text-xs text-muted-foreground">
        All your payouts, and unwrapping SOL, are in{' '}
        <Link className="underline underline-offset-4" href="/dashboard/claims">
          Dashboard → Payouts
        </Link>
        .
      </p>
    </section>
  );
}
