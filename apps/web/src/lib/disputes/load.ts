import 'server-only';

// Phase 31 - Disputes: what a player may dispute, their tickets, and the admin queue. Visibility is
// the database's (RLS: own tickets, or all for admins); the admin queue's extra details are read
// with the service role only after the database confirmed the viewer is an admin.
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export type DisputeStatus = 'open' | 'approved' | 'rejected' | 'resolved' | 'expired' | 'failed';

export interface DisputeEvent {
  at: string;
  action: DisputeStatus | 'opened';
  actor: 'user' | 'admin' | 'worker' | string;
  note: string | null;
}

export interface Ticket {
  id: string;
  day: number;
  status: DisputeStatus;
  reason: string;
  evidence: string[];
  previousResult: 'failed' | 'indeterminate' | 'verified';
  reviewNote: string | null;
  resolutionTx: string | null;
  error: string | null;
  createdAt: string;
  events: DisputeEvent[];
  challenge: { address: string; title: string };
}

/** A recorded day the player may still dispute. */
export interface DisputableDay {
  day: number;
  result: 'failed' | 'indeterminate';
  /** A Shield already keeps this day: a dispute only corrects the record, the streak is safe. */
  shielded: boolean;
}

type Raw = Record<string, unknown>;
const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T;

function ticketOf(r: Raw): Ticket {
  const m = one<{ challenges: unknown }>(r.memberships);
  const c = one<{ onchain_address: string; title: string }>(m?.challenges);
  return {
    id: r.id as string,
    day: r.day as number,
    status: r.status as DisputeStatus,
    reason: r.reason as string,
    evidence: (r.evidence_urls as string[]) ?? [],
    previousResult: r.previous_result as Ticket['previousResult'],
    reviewNote: (r.review_note as string | null) ?? null,
    resolutionTx: (r.resolution_tx as string | null) ?? null,
    error: (r.error as string | null) ?? null,
    createdAt: r.created_at as string,
    events: ((r.dispute_events as Raw[]) ?? [])
      .map((e) => ({ at: e.at as string, action: e.action as DisputeEvent['action'], actor: e.actor_kind as string, note: (e.note as string | null) ?? null }))
      .sort((a, b) => a.at.localeCompare(b.at)),
    challenge: { address: c?.onchain_address ?? '', title: c?.title ?? 'Challenge' },
  };
}

const TICKET_COLUMNS =
  'id, day, status, reason, evidence_urls, previous_result, review_note, resolution_tx, error, created_at, dispute_events(at, action, actor_kind, note), memberships!inner(challenge_id, challenges!inner(onchain_address, title))';

/** The viewer's own tickets (RLS), optionally for one membership. */
export async function myTickets(supabase: SupabaseClient, profileId: string, membershipId?: string): Promise<Ticket[]> {
  let q = supabase.from('disputes').select(TICKET_COLUMNS).eq('opened_by', profileId).order('created_at', { ascending: false }).limit(50);
  if (membershipId) q = q.eq('membership_id', membershipId);
  const { data } = await q;
  return (data ?? []).map((r) => ticketOf(r as Raw));
}

/** Recorded failed / "could not verify" days of a membership, while the dispute window is open. */
export async function disputableDays(supabase: SupabaseClient, membershipId: string, disputeEndMs: number): Promise<{ open: boolean; days: DisputableDay[] }> {
  if (Date.now() >= disputeEndMs) return { open: false, days: [] };
  const [{ data }, { data: shields }] = await Promise.all([
    supabase.from('day_results').select('day, result, onchain_at').eq('membership_id', membershipId).in('result', ['failed', 'indeterminate']).not('onchain_at', 'is', null).order('day'),
    supabase.from('shields').select('day').eq('membership_id', membershipId),
  ]);
  const covered = new Set((shields ?? []).map((s) => s.day as number));
  const days = (data ?? []).map((d) => ({ day: d.day as number, result: d.result as DisputableDay['result'], shielded: covered.has(d.day as number) }));
  // Days that actually cost the streak first.
  return { open: true, days: days.sort((a, b) => Number(a.shielded) - Number(b.shielded) || a.day - b.day) };
}

export interface AdminTicket extends Ticket {
  player: { username: string | null; wallet: string };
  /** The day's sealed receipt (what the rules engine decided and why), as stored. */
  receipt: Record<string, unknown> | null;
  disputeEndsAt: string;
  /** The program still accepts the upgrade (dispute window open) at load time. */
  windowOpen: boolean;
}

/**
 * The admin queue. `supabase` is the viewer's own client: the database decides whether they are an
 * admin (am_i_admin, and RLS on disputes). Only then are the players' details read.
 */
export async function adminQueue(supabase: SupabaseClient): Promise<AdminTicket[] | null> {
  const { data: isAdmin } = await supabase.rpc('am_i_admin');
  if (isAdmin !== true) return null;
  const { data } = await supabase.from('disputes').select(`${TICKET_COLUMNS}, membership_id, opened_by`).order('created_at', { ascending: false }).limit(200);
  const rows = (data ?? []) as Raw[];
  if (!rows.length) return [];
  const admin = createSupabaseAdminClient();
  const memberIds = [...new Set(rows.map((r) => r.membership_id as string))];
  const [{ data: members }, { data: receipts }] = await Promise.all([
    admin
      .from('memberships')
      .select('id, wallet_address, profiles(username), challenges(start_at, num_days, day_length_secs, verify_window_secs, dispute_window_secs)')
      .in('id', memberIds),
    admin.from('day_receipts').select('membership_id, day, receipt').in('membership_id', memberIds),
  ]);
  return rows.map((r) => {
    const m = (members ?? []).find((x) => x.id === r.membership_id) as Raw | undefined;
    const c = one<{ start_at: string; num_days: number; day_length_secs: number; verify_window_secs: number; dispute_window_secs: number }>(m?.challenges);
    const end = c ? Date.parse(c.start_at) + (c.num_days * c.day_length_secs + c.verify_window_secs + c.dispute_window_secs) * 1000 : 0;
    const rec = (receipts ?? []).find((x) => x.membership_id === r.membership_id && x.day === r.day);
    let receipt: Record<string, unknown> | null = null;
    try {
      receipt = rec ? (JSON.parse(rec.receipt as string) as Record<string, unknown>) : null;
    } catch {
      receipt = null;
    }
    return {
      ...ticketOf(r),
      player: { username: one<{ username: string | null }>(m?.profiles)?.username ?? null, wallet: (m?.wallet_address as string) ?? '' },
      receipt,
      disputeEndsAt: new Date(end).toISOString(),
      windowOpen: end > Date.now(),
    };
  });
}
