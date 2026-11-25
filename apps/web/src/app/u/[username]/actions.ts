'use server';

import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

const REASONS = ['cheating', 'harassment', 'spam', 'impersonation', 'inappropriate', 'other'] as const;
export type ReportReason = (typeof REASONS)[number];

/** Report a profile. The database enforces: signed in, not yourself, 5 a day, one open per person. */
export async function reportUserAction(username: string, reason: ReportReason, details: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in to report someone.' };
  if (typeof username !== 'string' || !/^[a-z0-9_]{3,20}$/.test(username)) return { ok: false, error: 'Unknown profile.' };
  if (!REASONS.includes(reason)) return { ok: false, error: 'Pick a reason.' };
  if (typeof details !== 'string' || details.length > 1000) return { ok: false, error: 'Details can be at most 1000 characters.' };
  const { error } = await (await createSupabaseServerClient()).rpc('report_user', { p_username: username, p_reason: reason, p_details: details.trim() || null });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
