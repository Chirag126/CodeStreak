import 'server-only';

import type { Token } from '@codestreak/shared';
import { PublicKey } from '@codestreak/shared/program';
import { cachedRead } from '@/lib/chain/read-cache';
import { serverConnection } from '@/lib/relayer/service';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// Phase 40: everything the landing page shows. Real data only: a figure that can't be loaded is
// null and the page shows "—"; nothing is ever estimated, padded or made up.

export interface LandingStats {
  players: number;
  challenges: number;
  verifiedDays: number;
  badges: number;
  grid: { date: string; verified: number; failed: number }[];
}

export interface FeaturedChallenge {
  address: string;
  title: string;
  token: Token;
  buyIn: bigint;
  pool: bigint;
  players: number;
  maxPlayers: number;
  numDays: number;
  demo: boolean;
  joinDeadline: string;
  startAt: string;
}

/** The counts and the hero grid, from one database function (public.landing_stats). */
export async function loadLandingStats(): Promise<LandingStats | null> {
  const { data, error } = await createSupabaseAdminClient().rpc('landing_stats');
  if (error || !data) {
    console.error('[landing] stats failed:', error?.message);
    return null;
  }
  const s = data as { players: number; challenges: number; verified_days: number; badges: number; grid: LandingStats['grid'] };
  return { players: Number(s.players), challenges: Number(s.challenges), verifiedDays: Number(s.verified_days), badges: Number(s.badges), grid: s.grid ?? [] };
}

/** Up to three PUBLIC challenges still open for joining (soonest deadline first). Never private groups. */
export async function loadFeatured(nowIso: string): Promise<FeaturedChallenge[] | null> {
  const { data, error } = await createSupabaseAdminClient()
    .from('challenges')
    .select('onchain_address, title, token, buy_in, total_stake, total_sponsor, participant_count, max_participants, num_days, is_demo, join_deadline_at, start_at')
    .eq('visibility', 'public')
    .eq('pool_state', 'open')
    .not('onchain_address', 'is', null)
    .gt('join_deadline_at', nowIso)
    .order('join_deadline_at', { ascending: true })
    .limit(3);
  if (error) return null;
  return (data ?? []).map((c) => ({
    address: c.onchain_address as string,
    title: c.title as string,
    token: c.token as Token,
    buyIn: BigInt(String(c.buy_in)),
    pool: BigInt(String(c.total_stake)) + BigInt(String(c.total_sponsor)),
    players: Number(c.participant_count),
    maxPlayers: Number(c.max_participants),
    numDays: Number(c.num_days),
    demo: Boolean(c.is_demo),
    joinDeadline: c.join_deadline_at as string,
    startAt: c.start_at as string,
  }));
}

/**
 * Read from the chain: what the challenge vaults hold right now (stakes, Shields and sponsorships
 * not yet paid out), per token. Vault addresses come from the database; balances from Solana
 * (one batched call, cached a minute). Null if the RPC is unavailable.
 */
export async function loadEscrow(): Promise<Partial<Record<Token, bigint>> | null> {
  const { data, error } = await createSupabaseAdminClient().from('challenges').select('vault, token').not('vault', 'is', null).is('payouts_done_at', null);
  if (error) return null;
  const rows = (data ?? []).filter((r) => r.vault);
  if (!rows.length) return {};
  try {
    const out: Partial<Record<Token, bigint>> = {};
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const keys = batch.map((r) => new PublicKey(r.vault as string));
      const infos = await cachedRead(`landing-vaults:${keys.map((k) => k.toBase58()).join(',')}`, 60_000, () => serverConnection().getMultipleAccountsInfo(keys));
      infos.forEach((info, j) => {
        // SPL token account: amount is a little-endian u64 at bytes 64..72. Closed vault = nothing held.
        if (!info || info.data.length < 72) return;
        const t = batch[j]!.token as Token;
        out[t] = (out[t] ?? 0n) + Buffer.from(info.data).readBigUInt64LE(64);
      });
    }
    return out;
  } catch (e) {
    console.error('[landing] escrow read failed:', e instanceof Error ? e.message : e);
    return null;
  }
}
