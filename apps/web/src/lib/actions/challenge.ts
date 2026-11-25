import 'server-only';

import { looksLikeAddress, type ActionChallenge, type Token } from '@codestreak/shared';
import { challengePhase, createProgram, PublicKey } from '@codestreak/shared/program';
import { serverConnection } from '@/lib/relayer/service';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const secs = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/**
 * A PUBLIC challenge for a Blink, from the database mirror. Private groups (and unknown or
 * malformed addresses) return null, so their title, size or existence never leak through Actions.
 * The relayer re-checks everything against the chain when it builds the transaction.
 */
export async function loadActionChallenge(address: string, now: number): Promise<ActionChallenge | null> {
  if (!looksLikeAddress(address)) return null;
  const { data: c } = await createSupabaseAdminClient()
    .from('challenges')
    .select('title, visibility, token, buy_in, num_days, day_length_secs, start_at, join_deadline_at, verify_window_secs, dispute_window_secs, pool_state, participant_count, max_participants, total_stake, total_sponsor, rules, is_demo')
    .eq('onchain_address', address)
    .maybeSingle();
  if (!c || c.visibility !== 'public') return null;
  const phase = challengePhase(
    {
      state: c.pool_state as 'open' | 'cancelled' | 'settled',
      startTs: secs(c.start_at as string),
      dayLengthSecs: Number(c.day_length_secs),
      numDays: Number(c.num_days),
      joinDeadlineTs: secs(c.join_deadline_at as string),
      verifyWindowSecs: Number(c.verify_window_secs),
      disputeWindowSecs: Number(c.dispute_window_secs),
    },
    now,
  );
  const providers = ((c.rules as { providers?: string[] } | null)?.providers ?? []).map((p) => (p === 'github' ? 'GitHub' : p === 'leetcode' ? 'LeetCode' : p));
  return {
    address,
    title: String(c.title),
    token: c.token as Token,
    buyIn: BigInt(String(c.buy_in)),
    numDays: Number(c.num_days),
    dayLengthSecs: Number(c.day_length_secs),
    players: Number(c.participant_count),
    maxPlayers: Number(c.max_participants),
    pool: BigInt(String(c.total_stake)) + BigInt(String(c.total_sponsor)),
    providers,
    joinOpen: phase === 'joining',
    sponsorOpen: phase === 'joining' || phase === 'starting' || phase === 'active',
    isDemo: Boolean(c.is_demo),
  };
}

/** The CodeStreak account that verified this wallet (Phase 13), or null. */
export async function profileForWallet(account: string): Promise<string | null> {
  const { data } = await createSupabaseAdminClient().from('wallets').select('profile_id').eq('address', account).not('verified_at', 'is', null).maybeSingle();
  return (data?.profile_id as string | undefined) ?? null;
}

export const NOT_PUBLIC = 'This challenge is not available as a Blink: only public CodeStreak challenges are.';
export const NO_ACCOUNT = 'This wallet is not linked to a CodeStreak account. Sign in at CodeStreak, link this wallet (Dashboard → Wallet) and the coding accounts the challenge needs, then try again.';

/** The challenge's rules fingerprint as stored on-chain (hex), or null if it isn't there. */
export async function onchainRulesHash(address: string): Promise<string | null> {
  try {
    const c = await createProgram(serverConnection()).account.challenge.fetch(new PublicKey(address));
    return Buffer.from(c.rulesHash).toString('hex');
  } catch {
    return null;
  }
}
