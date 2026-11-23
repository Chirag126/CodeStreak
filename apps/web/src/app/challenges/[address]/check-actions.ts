'use server';

import { isSolanaAddress } from '@codestreak/shared/wallet';
import { z } from 'zod';
import { checkMemberDay, readDayLog, type DayCheckResult, type DayLog } from '@/lib/verification/day-check';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

/** "Check now": the signed-in member checks their own current day. */
export async function checkMyDayAction(address: string): Promise<DayCheckResult & { log?: DayLog | null }> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  if (!isSolanaAddress(String(address))) return { ok: false, error: 'Invalid challenge.' };
  const r = await checkMemberDay(viewer.userId, address);
  if (!r.ok) return r;
  const supabase = await createSupabaseServerClient();
  const { data: c } = await supabase.from('challenges').select('id').eq('onchain_address', address).maybeSingle();
  const { data: m } = c ? await supabase.from('memberships').select('id').eq('challenge_id', c.id).eq('profile_id', viewer.userId).maybeSingle() : { data: null };
  return { ...r, log: m ? await readDayLog(supabase, m.id as string, r.day) : null };
}

/** A member's log for a day, as the viewer is allowed to see it (the database decides). */
export async function dayLogAction(membershipId: string, day: number): Promise<DayLog | null> {
  if (!z.uuid().safeParse(membershipId).success || !Number.isInteger(day) || day < 0 || day > 59) return null;
  return readDayLog(await createSupabaseServerClient(), membershipId, day);
}
