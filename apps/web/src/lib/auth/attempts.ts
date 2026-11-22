import 'server-only';

import { nextAttemptAt, SIGN_IN_LIMITS } from '@codestreak/shared';
import { createHash } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export type AttemptKind = 'send' | 'bad_code';

const hashEmail = (email: string) => createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
const MAX: Record<AttemptKind, number> = { send: SIGN_IN_LIMITS.maxSends, bad_code: SIGN_IN_LIMITS.maxBadCodes };

/** When this email may try again (ms epoch), or null if it may try now. Fails open if the DB is down. */
export async function attemptBlockedUntil(email: string, kind: AttemptKind): Promise<number | null> {
  const since = new Date(Date.now() - SIGN_IN_LIMITS.windowSecs * 1000).toISOString();
  const { data, error } = await createSupabaseAdminClient()
    .from('sign_in_attempts')
    .select('at')
    .eq('email_hash', hashEmail(email))
    .eq('kind', kind)
    .gt('at', since)
    .order('at', { ascending: false })
    .limit(MAX[kind]);
  if (error) {
    console.error('[sign-in] attempt lookup failed:', error.message);
    return null;
  }
  return nextAttemptAt((data ?? []).map((r) => Date.parse(r.at as string)), Date.now(), MAX[kind]);
}

export async function recordAttempt(email: string, kind: AttemptKind): Promise<void> {
  const admin = createSupabaseAdminClient();
  const emailHash = hashEmail(email);
  await admin.from('sign_in_attempts').insert({ email_hash: emailHash, kind });
  // Keep the table small: this address's attempts older than a day are useless.
  await admin.from('sign_in_attempts').delete().eq('email_hash', emailHash).lt('at', new Date(Date.now() - 86_400_000).toISOString());
}
