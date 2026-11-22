import 'server-only';

import { nextAttemptAt, SIGN_IN_LIMITS } from '@codestreak/shared';
import { createHash } from 'node:crypto';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

export type AttemptKind = 'send' | 'bad_code' | 'wallet_challenge' | 'wallet_failure';

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Rate-limit keys (hashed, so the table never holds emails or addresses). */
export const attemptKey = {
  email: (email: string) => sha256(email.trim().toLowerCase()),
  /** Wallet addresses are case-sensitive base58: no lower-casing. */
  wallet: (address: string) => sha256(`wallet:${address}`),
  browser: (browserHash: string) => sha256(`browser:${browserHash}`),
  ip: (ip: string) => sha256(`ip:${ip}`),
};

const MAX: Record<AttemptKind, number> = {
  send: SIGN_IN_LIMITS.maxSends,
  bad_code: SIGN_IN_LIMITS.maxBadCodes,
  // Per browser (and a looser per-network cap): never per wallet address, so nobody can lock a
  // wallet's owner out by spamming requests for their address. Forgery is impossible anyway (it
  // needs the wallet's key); these limits only stop spam.
  wallet_challenge: 10,
  wallet_failure: 5,
};

/** When `key` may try again (ms epoch), or null if it may try now. Fails open if the DB is down. */
export async function attemptBlockedUntil(key: string, kind: AttemptKind, max: number = MAX[kind]): Promise<number | null> {
  const since = new Date(Date.now() - SIGN_IN_LIMITS.windowSecs * 1000).toISOString();
  const { data, error } = await createSupabaseAdminClient()
    .from('sign_in_attempts')
    .select('at')
    .eq('email_hash', key)
    .eq('kind', kind)
    .gt('at', since)
    .order('at', { ascending: false })
    .limit(max);
  if (error) {
    console.error('[sign-in] attempt lookup failed:', error.message);
    return null;
  }
  return nextAttemptAt((data ?? []).map((r) => Date.parse(r.at as string)), Date.now(), max);
}

export async function recordAttempt(key: string, kind: AttemptKind): Promise<void> {
  const admin = createSupabaseAdminClient();
  await admin.from('sign_in_attempts').insert({ email_hash: key, kind });
  // Keep the table small: this key's attempts older than a day are useless.
  await admin.from('sign_in_attempts').delete().eq('email_hash', key).lt('at', new Date(Date.now() - 86_400_000).toISOString());
}
