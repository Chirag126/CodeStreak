import 'server-only';

import { computeInsights, type Token } from '@codestreak/shared';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { cachedRead } from '@/lib/chain/read-cache';
import { serverConnection } from '@/lib/relayer/service';

// Phase 37.1 - read models for the Developer Control Center. Every function takes the VERIFIED owner
// id (from currentOwner) and is only called from owner-gated pages. Reads use the service role on the
// server; nothing here returns tokens, password hashes, private keys or signing secrets (none are
// stored by CodeStreak; auth secrets stay inside Supabase Auth and are never selected).

const db = () => createSupabaseAdminClient();
export const PAGE_SIZE = 25;
const NONE = '00000000-0000-0000-0000-000000000000';
const one = <T>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
const secs = (iso: string) => Math.floor(Date.parse(iso) / 1000);

export function pageOf(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

// ------------------------------------------------------------------ overview
export interface OverviewSeriesPoint {
  date: string;
  signups: number;
  verified: number;
  failed: number;
  indeterminate: number;
  joins: number;
  transactions: number;
}
export interface Overview {
  users: number;
  active_7d: number;
  new_7d: number;
  suspended: number;
  banned: number;
  challenges: number;
  challenges_open: number;
  challenges_settled: number;
  groups: number;
  verified_days: number;
  usdc_staked: string;
  sol_staked: string;
  sponsorships: number;
  pending_claims: number;
  failed_transactions: number;
  failed_days: number;
  indeterminate_days: number;
  open_reports: number;
  open_appeals: number;
  series: OverviewSeriesPoint[];
}
export async function loadOverview(ownerId: string): Promise<Overview> {
  const { data, error } = await db().rpc('admin_overview', { p_actor: ownerId });
  if (error) throw new Error(`Overview failed: ${error.message}`);
  return data as Overview;
}

// ------------------------------------------------------------------ users directory
export interface DirectoryRow {
  id: string;
  username: string | null;
  display_name: string | null;
  public_id: string;
  avatar_url: string | null;
  created_at: string;
  email: string | null;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  status: string;
  restrictions: string[];
  wallets: string[];
  github: string | null;
  leetcode: string | null;
  joined: number;
  completed: number;
  groups: number;
  open_reports: number;
  flags: string[];
  currentStreak: number;
  longestStreak: number;
}

/** Streaks for a set of profiles (on-chain-recorded days, Shields keep a day: same as Insights). */
async function streaksFor(ids: string[], now: number): Promise<Map<string, { current: number; longest: number; successRate: number | null; recorded: number }>> {
  const out = new Map<string, { current: number; longest: number; successRate: number | null; recorded: number }>();
  if (!ids.length) return out;
  const { data: ms } = await db().from('memberships').select('id, profile_id, challenges!inner(start_at, day_length_secs)').in('profile_id', ids).limit(5000);
  const mIds = (ms ?? []).map((m) => m.id as string);
  const [{ data: rs }, { data: ss }] = await Promise.all([
    db().from('day_results').select('membership_id, day, result').in('membership_id', mIds.length ? mIds : [NONE]).not('onchain_at', 'is', null).limit(20000),
    db().from('shields').select('membership_id, day').in('membership_id', mIds.length ? mIds : [NONE]).limit(20000),
  ]);
  const shield = new Set((ss ?? []).map((s) => `${s.membership_id}:${s.day}`));
  const byProfile = new Map<string, { challenge: string; startedAt: number; result: 'verified' | 'failed' | 'indeterminate'; shielded: boolean }[]>();
  const info = new Map((ms ?? []).map((m) => [m.id as string, { profile: m.profile_id as string, c: one(m.challenges as unknown as { start_at: string; day_length_secs: number })! }]));
  for (const r of rs ?? []) {
    const m = info.get(r.membership_id as string);
    if (!m) continue;
    const list = byProfile.get(m.profile) ?? [];
    list.push({ challenge: r.membership_id as string, startedAt: secs(m.c.start_at) + (r.day as number) * m.c.day_length_secs, result: r.result as 'verified', shielded: shield.has(`${r.membership_id}:${r.day}`) });
    byProfile.set(m.profile, list);
  }
  for (const id of ids) {
    const ins = computeInsights(byProfile.get(id) ?? [], [], now, 1);
    out.set(id, { current: ins.currentStreak, longest: ins.longestStreak, successRate: ins.successRate, recorded: ins.recordedDays });
  }
  return out;
}

export async function loadDirectory(ownerId: string, opts: { q: string; status: string; sort: string; page: number }, now: number): Promise<{ total: number; rows: DirectoryRow[] }> {
  const { data, error } = await db().rpc('admin_list_users', {
    p_actor: ownerId,
    p_query: opts.q.slice(0, 120),
    p_status: opts.status,
    p_sort: opts.sort,
    p_limit: PAGE_SIZE,
    p_offset: (opts.page - 1) * PAGE_SIZE,
  });
  if (error) throw new Error(`User search failed: ${error.message}`);
  const res = data as { total: number; rows: Omit<DirectoryRow, 'currentStreak' | 'longestStreak'>[] };
  const streaks = await streaksFor(res.rows.map((r) => r.id), now);
  return { total: res.total, rows: res.rows.map((r) => ({ ...r, currentStreak: streaks.get(r.id)?.current ?? 0, longestStreak: streaks.get(r.id)?.longest ?? 0 })) };
}

// ------------------------------------------------------------------ one user, everything stored
export interface ChainCheck {
  signature: string;
  status: 'finalized' | 'confirmed' | 'processed' | 'failed' | 'not_found' | 'unknown';
}

/** Confirms signatures against Solana devnet (batched, cached 60 s). "unknown" = RPC unavailable. */
async function chainStatuses(signatures: string[]): Promise<Map<string, ChainCheck['status']>> {
  const out = new Map<string, ChainCheck['status']>();
  const sigs = [...new Set(signatures)].slice(0, 256);
  if (!sigs.length) return out;
  try {
    const conn = serverConnection();
    for (let i = 0; i < sigs.length; i += 100) {
      const batch = sigs.slice(i, i + 100);
      const res = await cachedRead(`sigstatus:${batch.join(',')}`, 60_000, () => conn.getSignatureStatuses(batch, { searchTransactionHistory: true }));
      res.value.forEach((v, j) => out.set(batch[j]!, v === null ? 'not_found' : v.err ? 'failed' : (v.confirmationStatus ?? 'processed')));
    }
  } catch {
    for (const s of sigs) if (!out.has(s)) out.set(s, 'unknown');
  }
  return out;
}

export async function loadUserDetail(ownerId: string, userId: string, now: number) {
  const c = db();
  const { data: profile } = await c.from('profiles').select('id, public_id, username, display_name, avatar_url, bio, timezone, created_at, updated_at').eq('id', userId).maybeSingle();
  if (!profile) return null;
  // Opening a full record is itself an audited action.
  await c.rpc('admin_log_access', { p_actor: ownerId, p_action: 'view.user_detail', p_target: userId, p_detail: {} });

  const [authInfo, moderation, flags, notes, actions, reportsAgainst, reportsBy, appeals, wallets, linked, memberships, sponsorships, invitesSent, invitesReceived, created, receipts, relayer, disputes, notifications, audit] =
    await Promise.all([
      c.rpc('admin_auth_info', { p_actor: ownerId, p_target: userId }),
      c.from('account_moderation').select('*').eq('profile_id', userId).maybeSingle(),
      c.from('moderation_flags').select('id, flag, reason, added_at, removed_at, removed_reason').eq('profile_id', userId).order('added_at', { ascending: false }),
      c.from('admin_notes').select('id, body, created_at').eq('profile_id', userId).order('created_at', { ascending: false }),
      c.from('moderation_actions').select('id, action, reason, params, before, after, created_at').eq('profile_id', userId).order('created_at', { ascending: false }).limit(200),
      c.from('user_reports').select('id, reason, details, status, resolution, created_at, resolved_at, reporter:profiles!user_reports_reporter_id_fkey(username)').eq('reported_id', userId).order('created_at', { ascending: false }),
      c.from('user_reports').select('id, reason, details, status, created_at, reported:profiles!user_reports_reported_id_fkey(username)').eq('reporter_id', userId).order('created_at', { ascending: false }),
      c.from('moderation_appeals').select('id, message, status, decision_note, created_at, decided_at').eq('profile_id', userId).order('created_at', { ascending: false }),
      c.from('wallets').select('address, kind, is_primary, verified_at, created_at').eq('profile_id', userId),
      c.from('linked_accounts').select('provider, provider_username, provider_user_id, linked_at').eq('profile_id', userId),
      c
        .from('memberships')
        .select('id, status, deposited, payout, claimed_at, joined_at, wallet_address, participant_address, challenges!inner(id, title, onchain_address, visibility, token, pool_state, start_at, day_length_secs, num_days, creator_id)')
        .eq('profile_id', userId)
        .order('joined_at', { ascending: false }),
      c.from('sponsorships').select('id, amount, message, tx_signature, created_at, challenges!inner(title, onchain_address, token, visibility)').eq('sponsor_id', userId).order('created_at', { ascending: false }),
      c.from('invitations').select('id, status, created_at, invitee:profiles!invitations_invitee_id_fkey(username), challenges!inner(title, onchain_address)').eq('invited_by', userId).order('created_at', { ascending: false }).limit(200),
      c.from('invitations').select('id, status, created_at, inviter:profiles!invitations_invited_by_fkey(username), challenges!inner(title, onchain_address)').eq('invitee_id', userId).order('created_at', { ascending: false }).limit(200),
      c.from('challenges').select('id, title, onchain_address, visibility, pool_state, created_at').eq('creator_id', userId).order('created_at', { ascending: false }),
      c.from('receipts').select('id, kind, amount, tx_signature, confirmed_at, wallet, challenges!inner(title, onchain_address, token, mint)').eq('profile_id', userId).order('confirmed_at', { ascending: false }).limit(500),
      c.from('relayer_requests').select('id, kind, status, signature, error, created_at, updated_at, challenge_address').eq('profile_id', userId).order('created_at', { ascending: false }).limit(200),
      c.from('disputes').select('id, day, status, previous_result, review_note, created_at, resolved_at, resolution_tx, memberships!inner(profile_id, challenges!inner(title, onchain_address))').eq('memberships.profile_id', userId).order('created_at', { ascending: false }),
      c.from('notifications').select('kind, title, created_at').eq('profile_id', userId).order('created_at', { ascending: false }).limit(50),
      c.from('admin_audit').select('id, at, action, reason, before, after').eq('target_profile', userId).order('id', { ascending: false }).limit(200),
    ]);

  const mIds = (memberships.data ?? []).map((m) => m.id as string);
  const inM = mIds.length ? mIds : [NONE];
  const [{ data: results }, { data: dayReceipts }, { data: shields }, { data: evidence }, { data: badges }] = await Promise.all([
    c.from('day_results').select('membership_id, day, result, source, evidence_count, evidence_hash, record_tx, onchain_at').in('membership_id', inM).order('onchain_at', { ascending: false, nullsFirst: false }).limit(5000),
    c.from('day_receipts').select('membership_id, day, engine, receipt, evidence_hash, created_at').in('membership_id', inM).limit(5000),
    c.from('shields').select('membership_id, day, price_paid, tx_signature, activated_at').in('membership_id', inM),
    c.from('evidence').select('membership_id, day, provider, kind, external_id, occurred_at, diff_hash, counted, reason').in('membership_id', inM).order('occurred_at', { ascending: false }).limit(2000),
    c.from('badges').select('challenge_id, badge_code, mint_address, mint_tx, awarded_at').eq('profile_id', userId),
  ]);

  const streak = (await streaksFor([userId], now)).get(userId)!;
  const sigs = [
    ...(receipts.data ?? []).map((r) => r.tx_signature as string),
    ...(relayer.data ?? []).filter((r) => r.signature).map((r) => r.signature as string),
  ];
  const onchain = await chainStatuses(sigs);

  return {
    profile,
    auth: (authInfo.data ?? null) as { email: string | null; email_confirmed_at: string | null; last_sign_in_at: string | null; created_at: string | null; banned_until: string | null } | null,
    moderation: moderation.data,
    flags: flags.data ?? [],
    notes: notes.data ?? [],
    actions: actions.data ?? [],
    reportsAgainst: reportsAgainst.data ?? [],
    reportsBy: reportsBy.data ?? [],
    appeals: appeals.data ?? [],
    wallets: wallets.data ?? [],
    linked: linked.data ?? [],
    memberships: memberships.data ?? [],
    sponsorships: sponsorships.data ?? [],
    invitesSent: invitesSent.data ?? [],
    invitesReceived: invitesReceived.data ?? [],
    created: created.data ?? [],
    receipts: receipts.data ?? [],
    relayer: relayer.data ?? [],
    disputes: disputes.data ?? [],
    notifications: notifications.data ?? [],
    audit: audit.data ?? [],
    results: results ?? [],
    dayReceipts: dayReceipts ?? [],
    shields: shields ?? [],
    evidence: evidence ?? [],
    badges: badges ?? [],
    streak,
    onchain: Object.fromEntries(onchain),
  };
}
export type UserDetail = NonNullable<Awaited<ReturnType<typeof loadUserDetail>>>;

// ------------------------------------------------------------------ platform tables (paginated)
export async function loadChallenges(opts: { q: string; visibility: 'public' | 'private' | 'all'; state: string; page: number }) {
  let q = db()
    .from('challenges')
    .select('id, title, onchain_address, visibility, token, pool_state, participant_count, total_stake, total_sponsor, start_at, num_days, day_length_secs, created_at, creator:profiles!challenges_creator_id_fkey(username)', { count: 'exact' })
    .not('onchain_address', 'is', null)
    .order('created_at', { ascending: false })
    .range((opts.page - 1) * PAGE_SIZE, opts.page * PAGE_SIZE - 1);
  if (opts.visibility !== 'all') q = q.eq('visibility', opts.visibility);
  if (['open', 'settled', 'cancelled'].includes(opts.state)) q = q.eq('pool_state', opts.state);
  if (opts.q) q = q.ilike('title', `%${opts.q.replace(/[\\%_]/g, (m) => `\\${m}`).slice(0, 80)}%`);
  const { data, count, error } = await q;
  if (error) throw new Error(`Challenges failed: ${error.message}`);
  return { rows: data ?? [], total: count ?? 0 };
}

export async function loadTransactions(opts: { kind: string; page: number }) {
  if (opts.kind === 'failed' || opts.kind === 'pending') {
    const { data, count, error } = await db()
      .from('relayer_requests')
      .select('id, kind, status, signature, error, created_at, challenge_address, wallet, profile:profiles!relayer_requests_profile_id_fkey(id, username)', { count: 'exact' })
      .in('status', opts.kind === 'failed' ? ['failed'] : ['prepared', 'submitting'])
      .order('created_at', { ascending: false })
      .range((opts.page - 1) * PAGE_SIZE, opts.page * PAGE_SIZE - 1);
    if (error) throw new Error(`Transactions failed: ${error.message}`);
    return { kind: 'relayer' as const, rows: data ?? [], total: count ?? 0, onchain: {} as Record<string, ChainCheck['status']> };
  }
  let q = db()
    .from('receipts')
    .select('id, kind, amount, tx_signature, confirmed_at, wallet, profile:profiles!receipts_profile_id_fkey(id, username), challenges!inner(title, onchain_address, token, mint, visibility)', { count: 'exact' })
    .order('confirmed_at', { ascending: false })
    .range((opts.page - 1) * PAGE_SIZE, opts.page * PAGE_SIZE - 1);
  if (['join', 'sponsor', 'shield', 'reward', 'refund', 'sponsor_refund'].includes(opts.kind)) q = q.eq('kind', opts.kind);
  const { data, count, error } = await q;
  if (error) throw new Error(`Transactions failed: ${error.message}`);
  const onchain = Object.fromEntries(await chainStatuses((data ?? []).map((r) => r.tx_signature as string)));
  return { kind: 'receipts' as const, rows: data ?? [], total: count ?? 0, onchain };
}

export async function loadVerification(opts: { result: string; page: number }) {
  let q = db()
    .from('day_results')
    .select('membership_id, day, result, source, evidence_count, evidence_hash, record_tx, onchain_at, memberships!inner(profile_id, profiles!inner(username), challenges!inner(title, onchain_address, visibility))', { count: 'exact' })
    .not('onchain_at', 'is', null)
    .order('onchain_at', { ascending: false })
    .range((opts.page - 1) * PAGE_SIZE, opts.page * PAGE_SIZE - 1);
  if (['verified', 'failed', 'indeterminate'].includes(opts.result)) q = q.eq('result', opts.result);
  const { data, count, error } = await q;
  if (error) throw new Error(`Verification failed: ${error.message}`);
  return { rows: data ?? [], total: count ?? 0 };
}

export async function loadModeration() {
  const c = db();
  const [reports, appeals, actions] = await Promise.all([
    c.from('user_reports').select('id, reason, details, status, created_at, reported:profiles!user_reports_reported_id_fkey(id, username), reporter:profiles!user_reports_reporter_id_fkey(username)').order('created_at', { ascending: false }).limit(100),
    c.from('moderation_appeals').select('id, message, status, created_at, decided_at, profile:profiles!moderation_appeals_profile_id_fkey(id, username)').order('created_at', { ascending: false }).limit(100),
    c.from('moderation_actions').select('id, action, reason, created_at, profile:profiles!moderation_actions_profile_id_fkey(id, username)').order('created_at', { ascending: false }).limit(100),
  ]);
  return { reports: reports.data ?? [], appeals: appeals.data ?? [], actions: actions.data ?? [] };
}

export async function loadAudit(page: number) {
  const { data, count, error } = await db()
    .from('admin_audit')
    .select('id, at, action, reason, target_profile, before, after, hash, prev_hash', { count: 'exact' })
    .order('id', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) throw new Error(`Audit failed: ${error.message}`);
  // The audit keeps raw ids (no foreign key, so entries outlive accounts): resolve names for display.
  const ids = [...new Set((data ?? []).map((r) => r.target_profile as string | null).filter(Boolean))] as string[];
  const { data: names } = ids.length ? await db().from('profiles').select('id, username').in('id', ids) : { data: [] };
  const nameOf = new Map((names ?? []).map((n) => [n.id as string, n.username as string | null]));
  return { rows: (data ?? []).map((r) => ({ ...r, target_username: r.target_profile ? (nameOf.get(r.target_profile as string) ?? null) : null })), total: count ?? 0 };
}

export const tokenOf = (t: string): Token => (t === 'sol' ? 'sol' : 'usdc');
