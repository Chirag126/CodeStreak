import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ClaimCenter } from '@/components/claims/claim-center';
import { Reveal } from '@/components/motion/primitives';
import { RefreshOnFocus } from '@/components/motion/refresh-on-focus';
import { SIGN_IN_PATH, USERNAME_PATH } from '@/lib/auth/routes';
import { loadClaimCenter } from '@/lib/claims/service';
import { getViewer } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Payouts' };
export const dynamic = 'force-dynamic';

export default async function ClaimsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect(SIGN_IN_PATH);
  if (!viewer.username) redirect(USERNAME_PATH);
  const data = await loadClaimCenter(viewer.userId);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-12 sm:px-6">
      <RefreshOnFocus />
      <Reveal trigger="mount" className="space-y-2">
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
          ← Dashboard
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Payouts</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Rewards and refunds are sent to your wallet automatically a few minutes after a challenge settles. Everything here comes straight from Solana
          devnet: what you were paid, what is ready, and where each amount came from.
        </p>
      </Reveal>
      <ClaimCenter data={data} />
    </div>
  );
}
