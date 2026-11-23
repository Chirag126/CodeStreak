import 'server-only';

import { LEETCODE_CODE_TTL_SECONDS, LEETCODE_LIMITS, normalizeLeetcodeHandle } from '@codestreak/shared';
import { checkBindingPage, scrapeLeetcodeProfile } from '@codestreak/shared/verification';
import { randomInt } from 'node:crypto';
import { inOpenChallenge } from '@/lib/accounts/github';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const newCode = () => `CS-LC-${Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;

export interface LeetcodeStatus {
  account: { handle: string; linkedAt: string } | null;
  locked: boolean;
  pending: { handle: string; code: string; expiresAt: string; attemptsLeft: number } | null;
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const TAKEN = 'This LeetCode account is already linked to another CodeStreak account.';
const COOLDOWN = 'This LeetCode account was linked to another CodeStreak user in the last 30 days, so it can’t be linked yet.';
const LOCKED = 'Your LeetCode account is locked while you are in an open challenge.';

function friendly(error: { code?: string; hint?: string; message?: string } | null): string {
  if (error?.code === '23505') return TAKEN;
  if (error?.hint === 'cooldown' || /30 days/.test(error?.message ?? '')) return COOLDOWN;
  if (error?.hint === 'locked' || /locked/.test(error?.message ?? '')) return LOCKED;
  return 'Could not save your LeetCode account. Try again.';
}

export async function leetcodeStatus(profileId: string): Promise<LeetcodeStatus> {
  const admin = createSupabaseAdminClient();
  const [{ data: row }, { data: code }, locked] = await Promise.all([
    admin.from('linked_accounts').select('provider_username, linked_at').eq('profile_id', profileId).eq('provider', 'leetcode').maybeSingle(),
    admin
      .from('leetcode_binding_codes')
      .select('handle, code, expires_at, attempts')
      .eq('profile_id', profileId)
      .is('used_at', null)
      .is('cancelled_at', null)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle(),
    inOpenChallenge(profileId),
  ]);
  return {
    account: row ? { handle: row.provider_username as string, linkedAt: row.linked_at as string } : null,
    locked,
    pending: code ? { handle: code.handle as string, code: code.code as string, expiresAt: code.expires_at as string, attemptsLeft: LEETCODE_LIMITS.attemptsPerCode - (code.attempts as number) } : null,
  };
}

/**
 * Step 1: a single-use code for this account AND this handle (15 minutes). Asking again cancels
 * the previous code. Refused early when the handle already belongs to someone else.
 */
export async function startLeetcodeBinding(profileId: string, rawHandle: string): Promise<Result<{ code: string; handle: string; expiresAt: string }>> {
  const handle = normalizeLeetcodeHandle(String(rawHandle).slice(0, 200));
  if (!handle) return { ok: false, error: 'That is not a LeetCode username. Use the name from your profile link: leetcode.com/u/<username>.' };
  const admin = createSupabaseAdminClient();

  const { data: mine } = await admin.from('linked_accounts').select('provider_user_id').eq('profile_id', profileId).eq('provider', 'leetcode').maybeSingle();
  if (mine) return { ok: false, error: 'You already linked a LeetCode account. Unlink it first to link a different one.' };
  const { data: taken } = await admin.from('linked_accounts').select('profile_id').eq('provider', 'leetcode').eq('provider_user_id', handle.toLowerCase()).maybeSingle();
  if (taken) return { ok: false, error: TAKEN };

  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await admin.from('leetcode_binding_codes').select('id', { count: 'exact', head: true }).eq('profile_id', profileId).gt('created_at', hourAgo);
  if ((count ?? 0) >= LEETCODE_LIMITS.codesPerHour) return { ok: false, error: `You asked for ${LEETCODE_LIMITS.codesPerHour} codes in the last hour. Use the latest one, or try again later.` };

  // One live code per person: cancel the previous one.
  await admin.from('leetcode_binding_codes').update({ cancelled_at: new Date().toISOString() }).eq('profile_id', profileId).is('used_at', null).is('cancelled_at', null);
  const expiresAt = new Date(Date.now() + LEETCODE_CODE_TTL_SECONDS * 1000).toISOString();
  for (let i = 0; i < 3; i++) {
    const code = newCode();
    const { error } = await admin.from('leetcode_binding_codes').insert({ profile_id: profileId, handle, code, expires_at: expiresAt });
    if (!error) return { ok: true, code, handle, expiresAt };
    if (error.code !== '23505') break;
  }
  return { ok: false, error: 'Could not create a code. Try again.' };
}

/**
 * Step 2: reads the profile live through Firecrawl and links the handle if its page is that
 * user's profile and shows the code. Each attempt is counted (5 per code); the code is consumed
 * on success. The handle comes from the stored code, never from the browser.
 */
export async function verifyLeetcodeBinding(profileId: string): Promise<Result<{ handle: string }>> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return { ok: false, error: 'LeetCode checks are not configured on this server (FIRECRAWL_API_KEY).' };
  const admin = createSupabaseAdminClient();
  const { data: row } = await admin
    .from('leetcode_binding_codes')
    .select('id, handle, code, expires_at, attempts')
    .eq('profile_id', profileId)
    .is('used_at', null)
    .is('cancelled_at', null)
    .maybeSingle();
  if (!row) return { ok: false, error: 'No code is waiting. Ask for a new code first.' };
  if (Date.parse(row.expires_at as string) <= Date.now()) return { ok: false, error: 'This code expired. Ask for a new code.' };
  const attempts = row.attempts as number;
  if (attempts >= LEETCODE_LIMITS.attemptsPerCode) return { ok: false, error: `This code was tried ${LEETCODE_LIMITS.attemptsPerCode} times. Ask for a new code.` };

  // Count the attempt first (an attempt that crashes mid-way still counts).
  const { data: counted } = await admin.from('leetcode_binding_codes').update({ attempts: attempts + 1 }).eq('id', row.id).eq('attempts', attempts).select('id');
  if (!counted?.length) return { ok: false, error: 'Another check is already running. Wait a moment and try again.' };

  const handle = row.handle as string;
  const page = await scrapeLeetcodeProfile(apiKey, handle);
  if (!page.ok) return { ok: false, error: 'LeetCode could not be read right now. Try again in a minute (this attempt still counted).' };
  const check = checkBindingPage({ pageStatus: page.pageStatus, title: page.title, markdown: page.markdown, handle, code: row.code as string });
  const left = LEETCODE_LIMITS.attemptsPerCode - attempts - 1;
  if (!check.ok) {
    const tail = left > 0 ? ` ${left} attempt${left === 1 ? '' : 's'} left for this code.` : ' Ask for a new code.';
    if (check.reason === 'no_profile') return { ok: false, error: `There is no LeetCode profile at leetcode.com/u/${handle}. Check the username.${tail}` };
    if (check.reason === 'unreadable') return { ok: false, error: `LeetCode's page for ${handle} didn't load properly. Try again in a minute.${tail}` };
    return {
      ok: false,
      error: `The code wasn't found on leetcode.com/u/${handle}. Put it in a field that shows on your public profile (the bio under your name, or ReadMe), save, open your profile to check it's visible, then verify again.${tail}`,
    };
  }

  // Consume the code (only one request can), then link.
  const { data: used } = await admin.from('leetcode_binding_codes').update({ used_at: new Date().toISOString() }).eq('id', row.id).is('used_at', null).is('cancelled_at', null).gt('expires_at', new Date().toISOString()).select('id');
  if (!used?.length) return { ok: false, error: 'This code expired or was replaced while checking. Ask for a new code.' };
  const { error } = await admin.from('linked_accounts').insert({ profile_id: profileId, provider: 'leetcode', provider_user_id: handle.toLowerCase(), provider_username: handle });
  if (error) return { ok: false, error: friendly(error) };
  await admin.from('audit_log').insert({ actor_kind: 'user', actor_id: profileId, action: 'account.link', entity_type: 'leetcode', entity_id: handle.toLowerCase(), details: { handle } });
  return { ok: true, handle };
}

export async function cancelLeetcodeBinding(profileId: string): Promise<void> {
  await createSupabaseAdminClient().from('leetcode_binding_codes').update({ cancelled_at: new Date().toISOString() }).eq('profile_id', profileId).is('used_at', null).is('cancelled_at', null);
}

/** Refused by the database while the user is in an open challenge (same rule as GitHub). */
export async function unlinkLeetcode(profileId: string): Promise<Result> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from('linked_accounts').delete().eq('profile_id', profileId).eq('provider', 'leetcode').select('provider_user_id');
  if (error) return { ok: false, error: friendly(error) };
  if (data?.length) await admin.from('audit_log').insert({ actor_kind: 'user', actor_id: profileId, action: 'account.unlink', entity_type: 'leetcode', entity_id: data[0]!.provider_user_id as string, details: {} });
  return { ok: true };
}
