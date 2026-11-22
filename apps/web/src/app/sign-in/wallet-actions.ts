'use server';

import { formatWait } from '@codestreak/shared';
import { addressProblem, buildLoginMessage, checkLogin, LOGIN_TTL_SECONDS } from '@codestreak/shared/wallet';
import { createHash, randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { attemptBlockedUntil, attemptKey, recordAttempt } from '@/lib/auth/attempts';
import { safeNext } from '@/lib/auth/routes';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** httpOnly cookie that ties a challenge to the browser that asked for it. */
const BROWSER_COOKIE = 'cs_wallet_login';
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const NOT_LINKED = "This wallet isn't linked to a CodeStreak account. Sign in with email once, then link it in Dashboard → Wallet.";
const GENERIC = 'Could not sign you in with this wallet. Try again, or use email.';

async function origin(): Promise<{ domain: string; uri: string }> {
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) {
    const u = new URL(appUrl);
    return { domain: u.host, uri: u.origin };
  }
  const h = await headers();
  const host = h.get('host') ?? 'localhost:3000';
  return { domain: host, uri: `${h.get('x-forwarded-proto') ?? 'http'}://${host}` };
}

/** Best-effort client network address (Render sets x-forwarded-for); only used for a spam cap. */
async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? 'unknown').trim().slice(0, 64);
}

/** A network (shared Wi-Fi, office) gets a few browsers' worth of requests. */
const IP_CHALLENGES = 30;

function waitError(until: number): string {
  return `Too many wallet sign-in attempts. Try again in ${formatWait((until - Date.now()) / 1000)}, or use email.`;
}

/**
 * Step 1: a single-use Sign In With Solana message for this wallet, valid 5 minutes, tied to this
 * browser. Issued for any valid address (whether linked or not), so it reveals nothing.
 */
export async function startWalletLogin(address: string): Promise<Result<{ message: string; nonce: string }>> {
  const problem = addressProblem(String(address));
  if (problem) return { ok: false, error: problem };

  const jar = await cookies();
  let browser = jar.get(BROWSER_COOKIE)?.value;
  if (!browser || !/^[A-Za-z0-9_-]{43}$/.test(browser)) {
    browser = randomBytes(32).toString('base64url');
    jar.set(BROWSER_COOKIE, browser, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: 15 * 60 });
  }
  const browserHash = sha256(browser);

  const browserKey = attemptKey.browser(browserHash);
  const ipKey = attemptKey.ip(await clientIp());
  for (const [key, kind] of [
    [browserKey, 'wallet_challenge'],
    [browserKey, 'wallet_failure'],
  ] as const) {
    const until = await attemptBlockedUntil(key, kind);
    if (until) return { ok: false, error: waitError(until) };
  }
  const ipBlocked = await attemptBlockedUntil(ipKey, 'wallet_challenge', IP_CHALLENGES);
  if (ipBlocked) return { ok: false, error: waitError(ipBlocked) };

  const { domain, uri } = await origin();
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + LOGIN_TTL_SECONDS * 1000);
  const nonce = randomBytes(16).toString('hex');
  const message = buildLoginMessage({ domain, uri, address, nonce, issuedAt, expiresAt });

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('wallet_login_challenges').insert({
    address,
    nonce,
    message,
    browser_hash: browserHash,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  });
  if (error) return { ok: false, error: GENERIC };
  await Promise.all([recordAttempt(browserKey, 'wallet_challenge'), recordAttempt(ipKey, 'wallet_challenge')]);
  // Housekeeping: challenges are useless an hour after expiry.
  await admin.from('wallet_login_challenges').delete().lt('expires_at', new Date(Date.now() - 3_600_000).toISOString());
  return { ok: true, message, nonce };
}

/**
 * Step 2: checks the signature against the exact message stored for this nonce (the client never
 * sends a message), consumes the nonce atomically, finds the account that verified this wallet,
 * and signs the browser in to that account. No email is sent.
 */
export async function finishWalletLogin(input: { address: string; nonce: string; signature: string; next?: string }): Promise<Result<{ next: string }>> {
  const address = String(input.address);
  if (addressProblem(address) || !/^[0-9a-f]{32}$/.test(String(input.nonce)) || String(input.signature).length > 200) return { ok: false, error: GENERIC };
  const browser = (await cookies()).get(BROWSER_COOKIE)?.value;
  if (!browser) return { ok: false, error: 'Sign-in request expired or was already used. Try again.' };
  const browserHash = sha256(browser);

  const failKey = attemptKey.browser(browserHash);
  const blocked = await attemptBlockedUntil(failKey, 'wallet_failure');
  if (blocked) return { ok: false, error: waitError(blocked) };

  const admin = createSupabaseAdminClient();
  const { data: row } = await admin
    .from('wallet_login_challenges')
    .select('id, address, message, browser_hash, expires_at, used_at')
    .eq('nonce', input.nonce)
    .maybeSingle();
  if (!row) return { ok: false, error: 'Sign-in request expired or was already used. Try again.' };

  const check = checkLogin({
    record: {
      address: row.address as string,
      message: row.message as string,
      browserHash: row.browser_hash as string,
      expiresAt: new Date(row.expires_at as string),
      usedAt: row.used_at ? new Date(row.used_at as string) : null,
    },
    address,
    browserHash,
    signature: Uint8Array.from(Buffer.from(String(input.signature), 'base64')),
    now: new Date(),
  });
  if (!check.ok) {
    if (check.reason === 'bad_signature' || check.reason === 'address_mismatch') await recordAttempt(failKey, 'wallet_failure');
    return { ok: false, error: check.message };
  }

  // Consume the nonce: only the first request with this signature gets a row back.
  const { data: consumed } = await admin
    .from('wallet_login_challenges')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id');
  if (!consumed?.length) return { ok: false, error: 'Sign-in request expired or was already used. Try again.' };

  // Only a wallet that its owner linked with a signed proof (Phase 13) can sign in, and a wallet
  // belongs to at most one account (unique constraint).
  const { data: wallet } = await admin.from('wallets').select('profile_id').eq('address', address).not('verified_at', 'is', null).maybeSingle();
  if (!wallet) return { ok: false, error: NOT_LINKED };

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(wallet.profile_id as string);
  const user = userData?.user;
  if (userError || !user?.email) return { ok: false, error: GENERIC };
  const bannedUntil = (user as { banned_until?: string | null }).banned_until;
  if (bannedUntil && Date.parse(bannedUntil) > Date.now()) return { ok: false, error: 'This account is suspended.' };

  // Mint a one-time token for that account without sending an email, and redeem it right here
  // into this browser's session cookies. The token never leaves the server.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: 'magiclink', email: user.email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash) return { ok: false, error: 'Please wait a minute and try again.' };
  const supabase = await createSupabaseServerClient();
  const { error: verifyError } = await supabase.auth.verifyOtp({ type: 'email', token_hash: tokenHash });
  if (verifyError) return { ok: false, error: 'Please wait a minute and try again.' };

  (await cookies()).delete(BROWSER_COOKIE);
  await admin.from('audit_log').insert({ actor_kind: 'user', actor_id: user.id, action: 'auth.wallet_login', entity_type: 'wallet', entity_id: address, details: {} });
  return { ok: true, next: safeNext(input.next) };
}
