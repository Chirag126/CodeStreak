import 'server-only';

import {
  activeChallenge,
  activitySeries,
  computeInsights,
  formatAmount,
  isActive,
  stakeAtRisk,
  TOKEN_DECIMALS,
  upcomingDeadlines,
  type ActivityPoint,
  type DashMembershipInput,
  type DeadlineItem,
  type InsightDay,
  type TodayStatus,
  type Token,
} from '@codestreak/shared';
import type { SupabaseClient } from '@supabase/supabase-js';

// Phase 35 - everything the developer dashboard shows, read with the viewer's own session (RLS),
// so a widget can only ever show what the viewer may see. Amounts leave here as formatted strings
// (no bigint crosses to the browser). Times are unix seconds (UTC).

export interface ActiveView {
  membershipId: string;
  title: string;
  address: string | null;
  token: Token;
  stake: string;
  potentialPayout: string;
  potentialProfit: string;
  profitPositive: boolean;
  stillIn: number;
  participants: number;
  day: number | null;
  numDays: number;
  dayLengthSecs: number;
  today: TodayStatus;
  countdownTo: number;
  countdownLabel: string;
  warning: boolean;
}

export interface ReceiptView {
  id: string;
  at: number;
  kind: 'day' | 'reward' | 'refund' | 'sponsor_refund';
  title: string;
  detail: string;
  /** Challenge page anchor or null. */
  href: string | null;
  tx: string | null;
}

export interface DashboardView {
  now: number;
  /** Nothing to show yet: no challenge ever joined. */
  isNew: boolean;
  linked: { github: boolean; leetcode: boolean; wallet: boolean };
  streak: { current: number; longest: number; successRate: number | null; recordedDays: number };
  active: ActiveView[];
  atRisk: { token: Token; amount: string }[];
  deadlines: DeadlineItem[];
  receipts: ReceiptView[];
  activity: ActivityPoint[];
  activityTotal: number;
}

const amount = (units: bigint, token: Token) => `${formatAmount(units, TOKEN_DECIMALS[token])} ${token.toUpperCase()}`;
const secs = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

interface ChallengeRow {
  id: string;
  title: string;
  onchain_address: string | null;
  token: Token;
  buy_in: string | number;
  pool_state: 'open' | 'cancelled' | 'settled';
  start_at: string;
  day_length_secs: number;
  num_days: number;
  join_deadline_at: string;
  participant_count: number;
  total_sponsor: string | number;
  total_shield: string | number;
}

export async function loadDashboard(supabase: SupabaseClient, profileId: string, now: number): Promise<DashboardView> {
  const [{ data: memberRows, error }, { data: linkedRows }, { count: walletCount }, { data: payoutRows }] = await Promise.all([
    supabase
      .from('memberships')
      .select(
        'id, status, deposited, challenges!inner(id, title, onchain_address, token, buy_in, pool_state, start_at, day_length_secs, num_days, join_deadline_at, participant_count, total_sponsor, total_shield)',
      )
      .eq('profile_id', profileId),
    supabase.from('linked_accounts').select('provider').eq('profile_id', profileId),
    supabase.from('wallets').select('address', { count: 'exact', head: true }).eq('profile_id', profileId),
    supabase.from('receipts').select('id, kind, amount, tx_signature, confirmed_at, challenges(title, onchain_address, token)').eq('profile_id', profileId).order('confirmed_at', { ascending: false }).limit(10),
  ]);
  if (error) throw new Error(`Loading your challenges failed: ${error.message}`);

  const members = (memberRows ?? []).map((m) => ({ id: m.id as string, status: m.status as DashMembershipInput['status'], deposited: BigInt(m.deposited as string), c: one(m.challenges as unknown as ChallengeRow)! }));
  // An empty `in ()` list is not valid PostgREST: a nil UUID matches nothing.
  const NONE = '00000000-0000-0000-0000-000000000000';
  const ids = members.length ? members.map((m) => m.id) : [NONE];

  const [{ data: results }, { data: shields }, { data: checks }, { data: evidence }] = await Promise.all([
        supabase.from('day_results').select('membership_id, day, result, evidence_hash, record_tx, onchain_at').in('membership_id', ids).not('onchain_at', 'is', null).limit(5000),
        supabase.from('shields').select('membership_id, day').in('membership_id', ids).limit(5000),
        supabase.from('member_day_checks').select('membership_id, day, outcome').in('membership_id', ids).limit(5000),
        supabase.from('evidence').select('membership_id, day, provider').in('membership_id', ids).eq('counted', true).limit(10000),
      ]);

  // "Still in" for running challenges: players with no uncovered failed day (public mirror rows).
  const runningIds = [...new Set(members.filter((m) => m.c.pool_state === 'open').map((m) => m.c.id))];
  const stillIn = new Map<string, number>();
  if (runningIds.length) {
    const { data: all } = await supabase.from('memberships').select('id, challenge_id, status').in('challenge_id', runningIds).limit(5000);
    const allIds = (all ?? []).length ? (all ?? []).map((m) => m.id as string) : [NONE];
    const [{ data: fails }, { data: allShields }] = await Promise.all([
      supabase.from('day_results').select('membership_id, day').in('membership_id', allIds).eq('result', 'failed').limit(10000),
      supabase.from('shields').select('membership_id, day').in('membership_id', allIds).limit(10000),
    ]);
    const covered = new Set((allShields ?? []).map((s) => `${s.membership_id}:${s.day}`));
    const out = new Set((fails ?? []).filter((f) => !covered.has(`${f.membership_id}:${f.day}`)).map((f) => f.membership_id as string));
    for (const m of all ?? []) {
      if (m.status !== 'active' && m.status !== 'survived') continue;
      if (out.has(m.id as string)) continue;
      stillIn.set(m.challenge_id as string, (stillIn.get(m.challenge_id as string) ?? 0) + 1);
    }
  }

  const byMember = <T extends { membership_id: unknown }>(rows: T[] | null) => {
    const map = new Map<string, T[]>();
    for (const r of rows ?? []) map.set(r.membership_id as string, [...(map.get(r.membership_id as string) ?? []), r]);
    return map;
  };
  const resultsBy = byMember(results);
  const shieldsBy = byMember(shields);
  const checksBy = byMember(checks);

  const inputs: DashMembershipInput[] = members.map((m) => {
    const res: DashMembershipInput['results'] = {};
    for (const r of resultsBy.get(m.id) ?? []) res[r.day as number] = r.result as 'verified' | 'failed' | 'indeterminate';
    // Any provider met → met; else any not_met → not_met; else unknown (the ANY rule's preview).
    const chk: DashMembershipInput['checks'] = {};
    for (const c of checksBy.get(m.id) ?? []) {
      const d = c.day as number;
      const o = c.outcome as 'met' | 'not_met' | 'unknown';
      if (o === 'met' || chk[d] === undefined || (o === 'not_met' && chk[d] === 'unknown')) chk[d] = o;
    }
    return {
      id: m.id,
      status: m.status,
      deposited: m.deposited,
      results: res,
      shieldDays: (shieldsBy.get(m.id) ?? []).map((s) => s.day as number),
      checks: chk,
      challenge: {
        id: m.c.id,
        title: m.c.title,
        address: m.c.onchain_address,
        token: m.c.token,
        buyIn: BigInt(m.c.buy_in),
        poolState: m.c.pool_state,
        startTs: secs(m.c.start_at),
        dayLengthSecs: m.c.day_length_secs,
        numDays: m.c.num_days,
        joinDeadlineTs: secs(m.c.join_deadline_at),
        participantCount: m.c.participant_count,
        totalSponsor: BigInt(m.c.total_sponsor),
        totalShield: BigInt(m.c.total_shield),
        stillIn: stillIn.get(m.c.id) ?? 0,
      },
    };
  });

  const active: ActiveView[] = inputs
    .filter((m) => isActive(m, now))
    .map((m) => {
      const a = activeChallenge(m, now);
      return {
        ...a,
        stake: amount(a.stake, a.token),
        potentialPayout: amount(a.potentialPayout, a.token),
        potentialProfit: `${a.potentialProfit >= 0n ? '+' : '−'}${amount(a.potentialProfit < 0n ? -a.potentialProfit : a.potentialProfit, a.token)}`,
        profitPositive: a.potentialProfit > 0n,
        dayLengthSecs: m.challenge.dayLengthSecs,
      };
    })
    .sort((x, y) => Number(y.warning) - Number(x.warning) || x.countdownTo - y.countdownTo);

  const risk = stakeAtRisk(inputs, now);
  const atRisk = (Object.keys(risk) as Token[]).filter((t) => risk[t] > 0n).map((t) => ({ token: t, amount: amount(risk[t], t) }));

  // Streak and activity from on-chain-recorded results only.
  const startOf = new Map(inputs.map((m) => [m.id, m.challenge]));
  const shieldSet = new Set((shields ?? []).map((s) => `${s.membership_id}:${s.day}`));
  const recorded = (results ?? []).map((r) => {
    const c = startOf.get(r.membership_id as string)!;
    return {
      membership: r.membership_id as string,
      day: r.day as number,
      startedAt: c.startTs + (r.day as number) * c.dayLengthSecs,
      result: r.result as InsightDay['result'],
      shielded: shieldSet.has(`${r.membership_id}:${r.day}`),
    };
  });
  const ev = (evidence ?? []).map((e) => {
    const c = startOf.get(e.membership_id as string)!;
    return { at: c.startTs + (e.day as number) * c.dayLengthSecs, provider: e.provider as 'github' | 'leetcode' };
  });
  const insights = computeInsights(
    recorded.map((r) => ({ challenge: r.membership, startedAt: r.startedAt, result: r.result, shielded: r.shielded })),
    ev,
    now,
  );
  const activity = activitySeries(recorded, ev, now, 30);

  // Receipts: sealed day receipts recorded on-chain, and payouts. Newest first.
  const titleOf = new Map(inputs.map((m) => [m.id, m.challenge]));
  const dayReceipts: ReceiptView[] = (results ?? []).map((r) => {
    const c = titleOf.get(r.membership_id as string)!;
    return {
      id: `day:${r.membership_id}:${r.day}`,
      at: secs(r.onchain_at as string),
      kind: 'day',
      title: `${c.title} · Day ${(r.day as number) + 1}: ${r.result === 'verified' ? 'verified' : r.result === 'failed' ? 'failed' : 'undecided'}`,
      detail: `Receipt hash ${(r.evidence_hash as string).slice(0, 10)}…`,
      href: c.address ? `/challenges/${c.address}#my-days` : null,
      tx: (r.record_tx as string | null) ?? null,
    };
  });
  const payouts: ReceiptView[] = (payoutRows ?? []).map((p) => {
    const c = one(p.challenges as unknown as { title: string; onchain_address: string | null; token: Token } | null);
    const kind = p.kind as ReceiptView['kind'];
    const token = c?.token ?? 'sol';
    return {
      id: `pay:${p.id}`,
      at: secs(p.confirmed_at as string),
      kind,
      title: `${c?.title ?? 'Challenge'} · ${kind === 'reward' ? 'Reward' : kind === 'refund' ? 'Refund' : 'Sponsor refund'}`,
      detail: amount(BigInt(p.amount as string), token),
      href: c?.onchain_address ? `/challenges/${c.onchain_address}` : null,
      tx: p.tx_signature as string,
    };
  });
  const receipts = [...dayReceipts, ...payouts].sort((a, b) => b.at - a.at).slice(0, 8);

  const linked = new Set((linkedRows ?? []).map((l) => l.provider as string));
  return {
    now,
    isNew: members.length === 0,
    linked: { github: linked.has('github'), leetcode: linked.has('leetcode'), wallet: (walletCount ?? 0) > 0 },
    streak: { current: insights.currentStreak, longest: insights.longestStreak, successRate: insights.successRate, recordedDays: insights.recordedDays },
    active,
    atRisk,
    deadlines: upcomingDeadlines(inputs, now, 6),
    receipts,
    activity,
    activityTotal: activity.reduce((a, p) => a + p.verified + p.failed + p.shielded + p.undecided + p.commits + p.solves, 0),
  };
}
