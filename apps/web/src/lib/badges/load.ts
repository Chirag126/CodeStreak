import 'server-only';
import { badgeMintPda, badgeTokenAccount, explorerAddressUrl, explorerTxUrl, PublicKey } from '@codestreak/shared/program';
import { serverConnection } from '@/lib/relayer/service';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { badgeName } from './metadata';

export type BadgeState =
  /** Minted, and the chain confirms the token sits in the player's own wallet. */
  | 'in_wallet'
  /** Minted (recorded) but the wallet check could not be made right now. */
  | 'minted'
  /** Survived; the worker mints it a few minutes after settlement. */
  | 'pending';

export interface BadgeView {
  challengeTitle: string;
  challengeAddress: string | null;
  numDays: number;
  name: string;
  state: BadgeState;
  wallet: string;
  mint: string | null;
  mintUrl: string | null;
  txUrl: string | null;
  metadataUrl: string | null;
  imageUrl: string | null;
  awardedAt: string | null;
}

interface MemberRow {
  wallet_address: string;
  participant_address: string | null;
  challenge_id: string;
  challenges: { title: string; onchain_address: string | null; num_days: number; pool_state: string } | null;
}

/** Every challenge the viewer survived, with its badge (minted or on its way). Scoped to the viewer. */
export async function loadMyBadges(profileId: string): Promise<BadgeView[]> {
  const db = createSupabaseAdminClient();
  const [{ data: members, error: mErr }, { data: badges, error: bErr }] = await Promise.all([
    db
      .from('memberships')
      .select('wallet_address,participant_address,challenge_id,challenges(title,onchain_address,num_days,pool_state)')
      .eq('profile_id', profileId)
      .eq('status', 'survived'),
    db.from('badges').select('challenge_id,mint_address,mint_tx,awarded_at').eq('profile_id', profileId).eq('badge_code', 'survivor'),
  ]);
  if (mErr) throw new Error(`loading your challenges failed: ${mErr.message}`);
  if (bErr) throw new Error(`loading your badges failed: ${bErr.message}`);

  const connection = serverConnection();
  const views = await Promise.all(
    ((members ?? []) as unknown as MemberRow[]).map(async (m): Promise<BadgeView> => {
      const c = m.challenges;
      const b = (badges ?? []).find((x) => x.challenge_id === m.challenge_id && x.mint_address);
      const participant = m.participant_address;
      let state: BadgeState = b ? 'minted' : 'pending';
      if (b && participant) {
        // The chain is the source of truth for "in your wallet": the badge account holds 1.
        try {
          const account = badgeTokenAccount(new PublicKey(m.wallet_address), new PublicKey(participant));
          const balance = await connection.getTokenAccountBalance(account);
          if (balance.value.amount === '1') state = 'in_wallet';
        } catch {
          // RPC unavailable: show it as minted (the record exists), not as missing.
        }
      }
      const mint = b?.mint_address ?? (participant ? badgeMintPda(new PublicKey(participant)).toBase58() : null);
      return {
        challengeTitle: c?.title ?? 'Challenge',
        challengeAddress: c?.onchain_address ?? null,
        numDays: c?.num_days ?? 0,
        name: badgeName(c?.num_days ?? 0),
        state,
        wallet: m.wallet_address,
        mint: b ? mint : null,
        mintUrl: b && mint ? explorerAddressUrl(mint) : null,
        txUrl: b?.mint_tx ? explorerTxUrl(b.mint_tx) : null,
        metadataUrl: participant ? `/api/badges/${participant}` : null,
        imageUrl: participant ? `/api/badges/${participant}/image` : null,
        awardedAt: b?.awarded_at ?? null,
      };
    }),
  );
  return views.sort((a, b) => (b.awardedAt ?? '9').localeCompare(a.awardedAt ?? '9'));
}
