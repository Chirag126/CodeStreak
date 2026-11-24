import Link from 'next/link';
import { loadMyBadges } from '@/lib/badges/load';

/** The signed-in survivor's badge for one challenge (challenge page, after settlement). */
export async function MyBadge({ profileId, address }: { profileId: string; address: string }) {
  const badge = (await loadMyBadges(profileId).catch(() => [])).find((b) => b.challengeAddress === address);
  if (!badge) return null;
  return (
    <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
      🏅 {badge.state === 'pending' ? 'You survived: your soulbound badge is being minted to your wallet.' : `${badge.name}: soulbound badge in your wallet.`}{' '}
      {badge.mintUrl && (
        <a className="underline underline-offset-4" href={badge.mintUrl} target="_blank" rel="noreferrer">
          View on Explorer ↗
        </a>
      )}{' '}
      <Link className="underline underline-offset-4" href="/dashboard/badges">
        All badges
      </Link>
    </p>
  );
}
