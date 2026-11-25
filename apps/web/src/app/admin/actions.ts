'use server';

import { revalidatePath } from 'next/cache';
import { isSensitive, RECENT_AUTH_MINUTES } from '@/lib/admin/identity';
import { currentOwner } from '@/lib/admin/owner';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// Phase 37.1 - the owner's write path. Every call: (1) re-verifies the owner on the server,
// (2) requires a recent sign-in for sensitive actions, (3) runs ONE database function that
// validates, applies, records history + hash-chained audit + notification atomically, and is
// idempotent on requestId. Nothing here trusts the browser.

const ACTIONS = [
  'warn', 'suspend', 'ban', 'reinstate', 'review', 'restrict', 'require_reverify', 'flag_add', 'flag_remove', 'note_add',
  'edit_profile', 'schedule_deletion', 'cancel_deletion', 'finalize_deletion', 'appeal_decide', 'report_set',
] as const;
export type AdminAction = (typeof ACTIONS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ActionResult = { ok: true; message: string; replay?: boolean } | { ok: false; error: string; reauth?: boolean };

export async function moderateAction(input: { target: string; action: AdminAction; reason: string; params: Record<string, unknown>; requestId: string }): Promise<ActionResult> {
  const owner = await currentOwner();
  if (!owner) return { ok: false, error: 'Not authorized.' };
  if (!UUID.test(input.target) || !UUID.test(input.requestId)) return { ok: false, error: 'Malformed request.' };
  if (!(ACTIONS as readonly string[]).includes(input.action)) return { ok: false, error: 'Unknown action.' };
  if (typeof input.reason !== 'string' || input.reason.trim().length < 5 || input.reason.length > 500) return { ok: false, error: 'Give a reason of 5 to 500 characters.' };
  const params = input.params && typeof input.params === 'object' && !Array.isArray(input.params) ? input.params : {};
  if (JSON.stringify(params).length > 4000) return { ok: false, error: 'Too much data in one action.' };
  if (isSensitive(input.action, params) && !owner.recentSignIn) {
    return { ok: false, reauth: true, error: `This action needs a sign-in within the last ${RECENT_AUTH_MINUTES} minutes. Sign out and in again, then retry.` };
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('admin_moderate', {
    p_actor: owner.id,
    p_target: input.target,
    p_action: input.action,
    p_reason: input.reason.trim(),
    p_params: params,
    p_request_id: input.requestId,
  });
  if (error) return { ok: false, error: error.message };
  const res = data as { ok: boolean; replay: boolean; auth: { ban_hours?: number; unban?: boolean; delete?: boolean } | null };

  // A finalized deletion also locks the login (the database already holds the deleted state).
  let note = '';
  if (res.auth?.delete) {
    const { error: authErr } = await admin.auth.admin.updateUserById(input.target, { ban_duration: '876000h' });
    if (authErr) note = ` The account is deleted in CodeStreak, but locking its login failed (${authErr.message}); retry the action.`;
  }
  revalidatePath('/admin', 'layout');
  return { ok: true, replay: res.replay, message: `${res.replay ? 'Already done' : 'Done'}.${note}` };
}

export async function verifyAuditChainAction(): Promise<ActionResult> {
  const owner = await currentOwner();
  if (!owner) return { ok: false, error: 'Not authorized.' };
  const { data, error } = await createSupabaseAdminClient().rpc('admin_verify_audit_chain', { p_actor: owner.id });
  if (error) return { ok: false, error: error.message };
  const r = data as { ok: boolean; entries: number; first_bad_id: number | null };
  return r.ok ? { ok: true, message: `Intact: all ${r.entries} entries verify.` } : { ok: false, error: `Broken at entry #${r.first_bad_id} (of ${r.entries} checked).` };
}
