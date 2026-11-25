import 'server-only';

import { buildPublicProfile, type ProfileChallengeInput, type PublicProfileBody, type Token } from '@codestreak/shared';
import { badgeTokenAccount, PublicKey } from '@codestreak/shared/program';
import { cachedRead } from '@/lib/chain/read-cache';
import { serverConnection } from '@/lib/relayer/service';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// Phase 37 - data for the public profile. Readable when logged out, so it uses the service role,
// and therefore every query here is scoped by hand: one profile, PUBLIC challenges only (the
// `challenges!inner(... visibility)` filter), only the columns the page shows. buildPublicProfile()
// filters for visibility again. Never select emails, timezones, auth ids or private-group rows here.

export interface PublicProfile extends PublicProfileBody {
  username: string;
  displayName: string | null;
  publicId: string;
  avatarUrl: string | null;
  memberSince: string;
  linked: { provider: 'github' | 'leetcode'; username: string; url: string }[];
}

const secs = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const NONE = '00000000-0000-0000-0000-000000000000';

interface ChallengeRow {
  id: string;
  title: string;
  onchain_address: string | null;
  token: Token;
  visibility: 'public' | 'private';
  start_at: string;
  day_length_secs: number;
  num_days: number;
  pool_state: 'open' | 'cancelled' | 'settled';
}

/** Badge held = the owner's Token-2022 account holds exactly 1 (cached; null if the RPC is busy). */
async function inWallet(wallet: string, participant: string): Promise<boolean | null> {
  try {
    const account = badgeTokenAccount(new PublicKey(wallet), new PublicKey(participant));
    const bal = await cachedRead(`badge-bal:${account.toBase58()}`, 60_000, () => serverConnection().getTokenAccountBalance(account));
    return bal.value.amount === '1';
  } catch {
    return null;
  }
}

export async function loadPublicProfile(username: string, now: number): Promise<PublicProfile | null> {
  const db = createSupabaseAdminClient();
  const { data: p, error } = await db.from('profiles').select('id, username, display_name, public_id, avatar_url, created_at').eq('username', username).maybeSingle();
  if (error) throw new Error(`Loading the profile failed: ${error.message}`);
  if (!p) return null;
  const profileId = p.id as string;

  const [{ data: linked }, { data: members, error: mErr }] = await Promise.all([
    db.from('linked_accounts').select('provider, provider_username').eq('profile_id', profileId),
    db
      .from('memberships')
      .select('id, status, deposited, payout, wallet_address, participant_address, challenges!inner(id, title, onchain_address, token, visibility, start_at, day_length_secs, num_days, pool_state)')
      .eq('profile_id', profileId)
      .eq('challenges.visibility', 'public')
      .limit(500),
  ]);
  if (mErr) throw new Error(`Loading the profile's challenges failed: ${mErr.message}`);

  const ms = (members ?? []).filter((m) => one(m.challenges as unknown as ChallengeRow)?.visibility === 'public');
  const ids = ms.length ? ms.map((m) => m.id as string) : [NONE];
  const challengeIds = ms.length ? ms.map((m) => one(m.challenges as unknown as ChallengeRow)!.id) : [NONE];

  const [{ data: results }, { data: shields }, { data: receipts }, { data: badges }] = await Promise.all([
    db.from('day_results').select('membership_id, day, result').in('membership_id', ids).not('onchain_at', 'is', null).limit(5000),
    db.from('shields').select('membership_id, day').in('membership_id', ids).limit(5000),
    db.from('receipts').select('challenge_id, kind, tx_signature').eq('profile_id', profileId).in('challenge_id', challengeIds).in('kind', ['join', 'reward', 'refund']).limit(2000),
    db.from('badges').select('challenge_id, mint_address, mint_tx').eq('profile_id', profileId).eq('badge_code', 'survivor').in('challenge_id', challengeIds).not('mint_address', 'is', null),
  ]);

  const rows: ProfileChallengeInput[] = await Promise.all(
    ms.map(async (m) => {
      const c = one(m.challenges as unknown as ChallengeRow)!;
      const tx = (kinds: string[]) => (receipts ?? []).find((r) => r.challenge_id === c.id && kinds.includes(r.kind as string))?.tx_signature as string | undefined;
      const b = (badges ?? []).find((x) => x.challenge_id === c.id);
      return {
        visibility: c.visibility,
        title: c.title,
        address: c.onchain_address,
        token: c.token,
        startTs: secs(c.start_at),
        dayLengthSecs: c.day_length_secs,
        numDays: c.num_days,
        poolState: c.pool_state,
        status: m.status as ProfileChallengeInput['status'],
        deposited: BigInt(m.deposited as string),
        payout: m.payout === null ? null : BigInt(m.payout as string),
        results: (results ?? []).filter((r) => r.membership_id === m.id).map((r) => ({ day: r.day as number, result: r.result as 'verified' })),
        shieldDays: (shields ?? []).filter((s) => s.membership_id === m.id).map((s) => s.day as number),
        joinTx: tx(['join']) ?? null,
        payoutTx: tx(['reward', 'refund']) ?? null,
        badge: b
          ? { mint: b.mint_address as string, tx: (b.mint_tx as string | null) ?? null, inWallet: m.participant_address ? await inWallet(m.wallet_address as string, m.participant_address as string) : null }
          : null,
      };
    }),
  );

  const linkedAccounts = (linked ?? []).map((l) => {
    const provider = l.provider as 'github' | 'leetcode';
    const name = l.provider_username as string;
    return { provider, username: name, url: provider === 'github' ? `https://github.com/${encodeURIComponent(name)}` : `https://leetcode.com/u/${encodeURIComponent(name)}/` };
  });
  const github = linkedAccounts.find((l) => l.provider === 'github');

  return {
    username: p.username as string,
    displayName: (p.display_name as string | null) ?? null,
    publicId: p.public_id as string,
    // Their own avatar, else their GitHub picture, else initials (in the page).
    avatarUrl: (p.avatar_url as string | null) ?? (github ? `https://github.com/${encodeURIComponent(github.username)}.png?size=160` : null),
    memberSince: (p.created_at as string).slice(0, 10),
    linked: linkedAccounts,
    ...buildPublicProfile(rows, now),
  };
}
