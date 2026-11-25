import 'server-only';

import { historyOutcome, type HistoryRow, type Token } from '@codestreak/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

// Every challenge the viewer played or sponsored, read with the viewer's own session (RLS): own
// memberships, own sponsorships, results of own memberships, own receipts, own badges.

interface ChallengeRow {
  id: string;
  title: string;
  onchain_address: string | null;
  token: Token;
  pool_state: 'open' | 'cancelled' | 'settled';
  start_at: string;
  day_length_secs: number;
  num_days: number;
}

const CH = 'id, title, onchain_address, token, pool_state, start_at, day_length_secs, num_days';
const secs = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const NONE = '00000000-0000-0000-0000-000000000000';

export async function loadHistory(supabase: SupabaseClient, profileId: string, now: number): Promise<HistoryRow[]> {
  const [{ data: members, error }, { data: sponsorships, error: sErr }, { data: receipts }, { data: badges }] = await Promise.all([
    supabase.from('memberships').select(`id, status, deposited, payout, challenge_id, challenges!inner(${CH})`).eq('profile_id', profileId).limit(1000),
    supabase.from('sponsorships').select(`id, amount, challenge_id, challenges!inner(${CH})`).eq('sponsor_id', profileId).limit(1000),
    supabase.from('receipts').select('challenge_id, kind, amount').eq('profile_id', profileId).limit(5000),
    supabase.from('badges').select('challenge_id, mint_address').eq('profile_id', profileId).eq('badge_code', 'survivor').limit(1000),
  ]);
  if (error) throw new Error(`Loading your challenges failed: ${error.message}`);
  if (sErr) throw new Error(`Loading your sponsorships failed: ${sErr.message}`);

  const ids = (members ?? []).length ? (members ?? []).map((m) => m.id as string) : [NONE];
  const [{ data: results }, { data: shields }] = await Promise.all([
    supabase.from('day_results').select('membership_id, day, result').in('membership_id', ids).not('onchain_at', 'is', null).limit(10000),
    supabase.from('shields').select('membership_id, day').in('membership_id', ids).limit(10000),
  ]);
  const shielded = new Set((shields ?? []).map((s) => `${s.membership_id}:${s.day}`));
  const counts = new Map<string, { verified: number; failed: number; shielded: number; undecided: number }>();
  for (const r of results ?? []) {
    const c = counts.get(r.membership_id as string) ?? { verified: 0, failed: 0, shielded: 0, undecided: 0 };
    if (r.result === 'verified') c.verified++;
    else if (shielded.has(`${r.membership_id}:${r.day}`)) c.shielded++;
    else if (r.result === 'failed') c.failed++;
    else c.undecided++;
    counts.set(r.membership_id as string, c);
  }
  const received = (challenge: string, kinds: string[]) =>
    (receipts ?? []).filter((r) => r.challenge_id === challenge && kinds.includes(r.kind as string)).reduce((a, r) => a + BigInt(r.amount as string), 0n);
  const badgeOf = new Map((badges ?? []).filter((b) => b.mint_address).map((b) => [b.challenge_id as string, b.mint_address as string]));

  const base = (c: ChallengeRow) => {
    const startTs = secs(c.start_at);
    return { title: c.title, address: c.onchain_address, token: c.token, startTs, endTs: startTs + c.num_days * c.day_length_secs, numDays: c.num_days };
  };

  const rows: HistoryRow[] = (members ?? []).map((m) => {
    const c = one(m.challenges as unknown as ChallengeRow)!;
    const b = base(c);
    return {
      key: `p:${m.id}`,
      role: 'player',
      ...b,
      outcome: historyOutcome('player', m.status as 'active', c.pool_state, b.endTs, now, m.payout === null ? null : BigInt(m.payout as string)),
      ...(counts.get(m.id as string) ?? { verified: 0, failed: 0, shielded: 0, undecided: 0 }),
      put: BigInt(m.deposited as string),
      received: received(c.id, ['reward', 'refund']),
      badgeMint: badgeOf.get(c.id) ?? null,
    };
  });

  // One row per sponsored challenge (several top-ups add up).
  const sponsored = new Map<string, HistoryRow>();
  for (const s of sponsorships ?? []) {
    const c = one(s.challenges as unknown as ChallengeRow)!;
    const prev = sponsored.get(c.id);
    if (prev) {
      prev.put += BigInt(s.amount as string);
      continue;
    }
    const b = base(c);
    sponsored.set(c.id, {
      key: `s:${c.id}`,
      role: 'sponsor',
      ...b,
      outcome: historyOutcome('sponsor', 'active', c.pool_state, b.endTs, now),
      verified: 0,
      failed: 0,
      shielded: 0,
      undecided: 0,
      put: BigInt(s.amount as string),
      received: received(c.id, ['sponsor_refund']),
      badgeMint: null,
    });
  }
  return [...rows, ...sponsored.values()];
}
