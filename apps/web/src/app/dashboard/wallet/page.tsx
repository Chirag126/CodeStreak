import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { WalletPanel, type LinkedWallet } from '@/components/wallet/wallet-panel';
import { SIGN_IN_PATH } from '@/lib/auth/routes';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Wallet' };

export default async function WalletPage() {
  const viewer = await getViewer();
  if (!viewer) redirect(SIGN_IN_PATH);
  const supabase = await createSupabaseServerClient();
  // RLS: only the user's own wallets are returned.
  const { data } = await supabase
    .from('wallets')
    .select('id, address, kind, is_primary, verified_at')
    .order('created_at', { ascending: true });
  const linked: LinkedWallet[] = (data ?? []).map((w) => ({
    id: w.id as string,
    address: w.address as string,
    kind: w.kind as string,
    isPrimary: Boolean(w.is_primary),
    verifiedAt: (w.verified_at as string | null) ?? null,
  }));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="space-y-1">
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground">
          ← Dashboard
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Wallet</h1>
        <p className="text-sm text-muted-foreground">Link a Solana wallet to stake devnet USDC or SOL. CodeStreak never sees your keys.</p>
      </div>
      <WalletPanel linked={linked} />
    </div>
  );
}
