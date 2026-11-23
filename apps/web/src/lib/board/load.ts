import 'server-only';

import type { BoardCheck, BoardInput, BoardMemberInput, BoardVisibility } from '@codestreak/shared';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

export interface BoardPayload {
  challengeId: string;
  input: BoardInput;
  viewer: { isCreator: boolean; membershipId: string | null; shareChecks: boolean };
}

const secs = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/**
 * Everything the group board shows, filtered for the viewer:
 *  - access: the challenge must be readable by the viewer (RLS on the viewer's own session);
 *  - owner setting: a board limited to players sends no members to anyone else;
 *  - member setting: a member's check details are sent only if they share them (or to themselves).
 * Day results are never hidden: they decide payouts and are public on-chain anyway.
 */
export async function loadBoard(address: string): Promise<BoardPayload | null> {
  const supabase = await createSupabaseServerClient();
  const { data: c } = await supabase
    .from('challenges')
    .select('id, creator_id, board_visibility, pool_state, start_at, day_length_secs, num_days, join_deadline_at, verify_window_secs, dispute_window_secs, min_participants, max_participants, total_stake, total_sponsor, total_shield')
    .eq('onchain_address', address)
    .maybeSingle();
  if (!c) return null;

  const viewer = await getViewer();
  const admin = createSupabaseAdminClient();
  const { data: memberships } = await admin
    .from('memberships')
    .select('id, profile_id, status, share_checks, profiles(public_id, display_name, username)')
    .eq('challenge_id', c.id)
    .limit(1000);
  const rows = memberships ?? [];
  const mine = viewer ? rows.find((m) => m.profile_id === viewer.userId) : undefined;
  const isCreator = Boolean(viewer && c.creator_id === viewer.userId);
  const visibility = c.board_visibility as BoardVisibility;
  const membersVisible = visibility === 'viewers' || isCreator || Boolean(mine);

  let members: BoardMemberInput[] = [];
  if (membersVisible && rows.length) {
    const ids = rows.map((m) => m.id as string);
    const [{ data: results }, { data: shields }, { data: evidence }, { data: dayChecks }] = await Promise.all([
      admin.from('day_results').select('membership_id, day, result').in('membership_id', ids).limit(60_000),
      admin.from('shields').select('membership_id, day').in('membership_id', ids).limit(5_000),
      admin.from('evidence').select('membership_id, day, provider, counted').in('membership_id', ids).limit(20_000),
      admin.from('member_day_checks').select('membership_id, day, lines, goal, outcome').in('membership_id', ids).limit(60_000),
    ]);

    members = rows.map((m) => {
      const id = m.id as string;
      const p = m.profiles as unknown as { public_id: string; display_name: string | null; username: string | null };
      const isViewer = Boolean(viewer && m.profile_id === viewer.userId);
      const shareChecks = m.share_checks as boolean;
      let checks: BoardCheck[] | undefined;
      if (shareChecks || isViewer) {
        const byDay = new Map<number, BoardCheck>();
        for (const e of evidence ?? []) {
          if (e.membership_id !== id) continue;
          const day = e.day as number;
          const entry = byDay.get(day) ?? { day, counted: 0, considered: 0, providers: [] };
          entry.considered += 1;
          if (e.counted) entry.counted += 1;
          const provider = e.provider as 'github' | 'leetcode';
          if (!entry.providers.includes(provider)) entry.providers.push(provider);
          byDay.set(day, entry);
        }
        for (const d of dayChecks ?? []) {
          if (d.membership_id !== id) continue;
          const day = d.day as number;
          const entry = byDay.get(day) ?? { day, counted: 0, considered: 0, providers: ['github'] };
          byDay.set(day, { ...entry, lines: d.lines as number, goal: d.goal as number, outcome: d.outcome as 'met' | 'not_met' | 'unknown' });
        }
        checks = [...byDay.values()].sort((a, b) => a.day - b.day);
      }
      return {
        membershipId: id,
        publicId: p.public_id,
        name: p.display_name ?? p.username ?? p.public_id,
        status: m.status as BoardMemberInput['status'],
        isViewer,
        isCreator: m.profile_id === c.creator_id,
        shareChecks,
        results: (results ?? [])
          .filter((r) => r.membership_id === id)
          .map((r) => ({ day: r.day as number, result: r.result as 'verified' | 'failed' | 'indeterminate' })),
        shieldDays: (shields ?? []).filter((s) => s.membership_id === id).map((s) => s.day as number),
        ...(checks ? { checks } : {}),
      };
    });
  }

  const pool = BigInt(String(c.total_stake)) + BigInt(String(c.total_sponsor)) + BigInt(String(c.total_shield));
  return {
    challengeId: c.id as string,
    viewer: { isCreator, membershipId: (mine?.id as string | undefined) ?? null, shareChecks: (mine?.share_checks as boolean | undefined) ?? true },
    input: {
      times: {
        state: c.pool_state as 'open' | 'cancelled' | 'settled',
        startTs: secs(c.start_at as string),
        dayLengthSecs: c.day_length_secs as number,
        numDays: c.num_days as number,
        joinDeadlineTs: secs(c.join_deadline_at as string),
        verifyWindowSecs: c.verify_window_secs as number,
        disputeWindowSecs: c.dispute_window_secs as number,
      },
      minParticipants: c.min_participants as number,
      maxParticipants: c.max_participants as number,
      poolTotal: pool.toString(),
      boardVisibility: visibility,
      membersVisible,
      memberCount: rows.length,
      members,
    },
  };
}
