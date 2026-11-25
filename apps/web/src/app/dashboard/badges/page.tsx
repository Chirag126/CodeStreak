import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BadgeGallery } from '@/components/badges/badge-gallery';
import { Reveal } from '@/components/motion/primitives';
import { RefreshOnFocus } from '@/components/motion/refresh-on-focus';
import { SIGN_IN_PATH, USERNAME_PATH } from '@/lib/auth/routes';
import { loadMyBadges } from '@/lib/badges/load';
import { getViewer } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Badges' };
export const dynamic = 'force-dynamic';

export default async function BadgesPage() {
  const viewer = await getViewer();
  if (!viewer) redirect(SIGN_IN_PATH);
  if (!viewer.username) redirect(USERNAME_PATH);
  const badges = await loadMyBadges(viewer.userId);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-12 sm:px-6">
      <RefreshOnFocus />
      <Reveal trigger="mount" className="space-y-2">
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
          ← Dashboard
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Badges</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Every challenge you survived earns a soulbound badge: a Token-2022 token with the NonTransferable extension, minted by the CodeStreak program
          straight to your wallet. Only the program can mint it, only for a Survived player, and only once. Solana devnet.
        </p>
      </Reveal>
      <BadgeGallery badges={badges} />
      {badges.some((b) => b.state !== 'pending') && (
        <p className="max-w-2xl rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
          <strong className="text-foreground">Not under Collectibles in Phantom?</strong> The badge is in your wallet (the check above reads your token account
          on-chain), but Phantom&apos;s devnet view doesn&apos;t list Token-2022 badges that keep their metadata on the token itself. Solana Explorer always shows
          it: <em>Token on Explorer</em> lists the owner, supply 1 and the Non-Transferable extension.
        </p>
      )}
    </div>
  );
}
