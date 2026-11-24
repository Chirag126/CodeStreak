import 'server-only';

import { buildLeaderboard, formatAmount, TOKEN_DECIMALS, type BoardKind, type LeaderMembership, type RankedEntry, type Token } from '@codestreak/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

// Phase 36 - leaderboard data, read with the viewer's session (RLS). Global = public challenges
// only (the same for everyone); group = one challenge the viewer can see. Only on-chain-recorded
// results count. Joins are done by PostgREST (no long id lists in the URL).

export interface BoardView {
  kind: BoardKind;
  token?: Token;
  entries: (Omit<RankedEntry, 'score'> & { score: string })[];
}

export interface LeaderboardData {
  scope: { kind: 'global' } | { kind: 'group'; title: string; address: string; challengeId: string };
  boards: BoardView[];
  players: number;
  now: number;
}

const secs = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export async function loadLeaderboards(supabase: SupabaseClient, now: number, groupAddress?: string): Promise<LeaderboardData | null> {
  let scope: LeaderboardData['scope'] = { kind: 'global' };
  if (groupAddress) {
    const { data: c } = await supabase.from('challenges').select('id, title, onchain_address').eq('onchain_address', groupAddress).maybeSingle();
    if (!c) return null; // unknown, or a private group the viewer can't see
    scope = { kind: 'group', title: c.title as string, address: c.onchain_address as string, challengeId: c.id as string };
  }

  const MEMBER = 'id, profile_id, status, deposited, payout, challenge_id, profiles!inner(username, display_name), challenges!inner(token, start_at, day_length_secs, visibility)';
  let members = supabase.from('memberships').select(MEMBER).limit(5000);
  let results = supabase.from('day_results').select('membership_id, day, result, memberships!inner(challenge_id, challenges!inner(visibility))').not('onchain_at', 'is', null).limit(20000);
  let shields = supabase.from('shields').select('membership_id, day, memberships!inner(challenge_id, challenges!inner(visibility))').limit(20000);
  if (scope.kind === 'group') {
    members = members.eq('challenge_id', scope.challengeId);
    results = results.eq('memberships.challenge_id', scope.challengeId);
    shields = shields.eq('memberships.challenge_id', scope.challengeId);
  } else {
    members = members.eq('challenges.visibility', 'public');
    results = results.eq('memberships.challenges.visibility', 'public');
    shields = shields.eq('memberships.challenges.visibility', 'public');
  }
  const [{ data: ms, error }, { data: rs, error: rErr }, { data: ss }] = await Promise.all([members, results, shields]);
  if (error) throw new Error(`Loading players failed: ${error.message}`);
  if (rErr) throw new Error(`Loading results failed: ${rErr.message}`);

  const resultsBy = new Map<string, LeaderMembership['results']>();
  for (const r of rs ?? []) resultsBy.set(r.membership_id as string, [...(resultsBy.get(r.membership_id as string) ?? []), { day: r.day as number, result: r.result as 'verified' }]);
  const shieldsBy = new Map<string, number[]>();
  for (const s of ss ?? []) shieldsBy.set(s.membership_id as string, [...(shieldsBy.get(s.membership_id as string) ?? []), s.day as number]);

  const input: LeaderMembership[] = (ms ?? []).map((m) => {
    const p = one(m.profiles as unknown as { username: string | null; display_name: string | null })!;
    const c = one(m.challenges as unknown as { token: Token; start_at: string; day_length_secs: number })!;
    return {
      profileId: m.profile_id as string,
      username: p.username,
      displayName: p.display_name,
      challengeId: m.challenge_id as string,
      token: c.token,
      startTs: secs(c.start_at),
      dayLengthSecs: c.day_length_secs,
      status: m.status as LeaderMembership['status'],
      deposited: BigInt(m.deposited as string),
      payout: m.payout === null ? null : BigInt(m.payout as string),
      results: resultsBy.get(m.id as string) ?? [],
      shieldDays: shieldsBy.get(m.id as string) ?? [],
    };
  });

  const show = (kind: BoardKind, token?: Token): BoardView => ({
    kind,
    token,
    entries: buildLeaderboard(kind, input, now, { token, limit: 50 }).map((e) => ({
      ...e,
      score: typeof e.score === 'bigint' ? `${formatAmount(e.score, TOKEN_DECIMALS[token ?? 'usdc'])} ${(token ?? 'usdc').toUpperCase()}` : kind === 'consistent' ? `${e.score}%` : `${e.score}`,
    })),
  });
  return {
    scope,
    boards: [show('weekly'), show('streak'), show('consistent'), show('earners', 'usdc'), show('earners', 'sol')],
    players: new Set(input.map((i) => i.profileId)).size,
    now,
  };
}
