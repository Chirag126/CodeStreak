'use server';

import { createClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { providerWaitSecs, SIGN_IN_LIMITS } from '@codestreak/shared';
import { attemptBlockedUntil, recordAttempt } from '@/lib/auth/attempts';
import { HOME_AFTER_SIGN_IN, safeNext, USERNAME_PATH } from '@/lib/auth/routes';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** `retryAt` (ms epoch): the form shows a countdown and keeps the button off until then. */
export type SignInState =
  | { step: 'email'; error?: string; email?: string; retryAt?: number }
  | { step: 'code'; email: string; error?: string; notice?: string; retryAt?: number };

const emailSchema = z.email('Enter a valid email address.').max(254);
const codeSchema = z.string().trim().regex(/^\d{6,10}$/, 'Enter the code from the email (numbers only).');

function friendly(message: string): string {
  if (/expired|invalid/i.test(message)) return 'That code is wrong or has expired. Request a new one.';
  return 'Something went wrong. Please try again.';
}

const TOO_MANY_SENDS = `You've asked for ${SIGN_IN_LIMITS.maxSends} sign-in emails. Use the newest one, or wait for the timer to request another.`;
const TOO_MANY_CODES = `${SIGN_IN_LIMITS.maxBadCodes} wrong codes. Wait for the timer, then try again or request a new email.`;
const PROVIDER_BUSY = 'Our email service is sending too many emails right now. Wait for the timer, then try again.';

/** Absolute URL of the email link's landing page (APP_URL on Render; the request origin locally). */
async function confirmUrl(next: string): Promise<string> {
  const origin = process.env.APP_URL?.trim() || (await headers()).get('origin') || 'http://localhost:3000';
  return `${origin.replace(/\/$/, '')}/auth/confirm?next=${encodeURIComponent(next)}`;
}

/**
 * Sends the sign-in email with the implicit flow, so the link works in ANY browser or device (the
 * email app's browser, a phone). The default PKCE flow only works in the browser that asked for
 * the email, because it needs a verifier cookie stored there; opened anywhere else it fails and the
 * user is sent back to sign in, forever. This client only sends the email and keeps no session.
 */
function emailClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { flowType: 'implicit', persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Step 1: email a sign-in link (creates the account on first sign-in). */
export async function requestCode(_prev: SignInState, form: FormData): Promise<SignInState> {
  const parsed = emailSchema.safeParse(String(form.get('email') ?? '').trim().toLowerCase());
  if (!parsed.success) return { step: 'email', error: parsed.error.issues[0]?.message, email: String(form.get('email') ?? '') };
  const email = parsed.data;

  const blockedUntil = await attemptBlockedUntil(email, 'send');
  if (blockedUntil) return { step: 'email', error: TOO_MANY_SENDS, email, retryAt: blockedUntil };

  const next = safeNext(String(form.get('next') ?? ''));
  const { error } = await emailClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: await confirmUrl(next) },
  });
  if (error) {
    const wait = providerWaitSecs({ message: error.message, code: error.code });
    if (wait) {
      const perAddress = /after \d+ seconds?/i.test(error.message);
      return { step: 'email', error: perAddress ? 'An email was just sent. Wait for the timer to request another.' : PROVIDER_BUSY, email, retryAt: Date.now() + wait * 1000 };
    }
    return { step: 'email', error: friendly(error.message), email };
  }
  await recordAttempt(email, 'send');
  return {
    step: 'code',
    email,
    notice: `We emailed ${email} a sign-in link. Open it on any device; only the newest link works. If the email shows a code instead, enter it below.`,
  };
}

/** Step 2: verify the code, then continue to the username step (new users) or where they were going. */
export async function verifyCode(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = emailSchema.safeParse(String(form.get('email') ?? ''));
  if (!email.success) return { step: 'email', error: 'Start again with your email.' };
  const code = codeSchema.safeParse(String(form.get('code') ?? ''));
  if (!code.success) return { step: 'code', email: email.data, error: code.error.issues[0]?.message };

  const blockedUntil = await attemptBlockedUntil(email.data, 'bad_code');
  if (blockedUntil) return { step: 'code', email: email.data, error: TOO_MANY_CODES, retryAt: blockedUntil };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: email.data, token: code.data, type: 'email' });
  if (error || !data.user) {
    const wait = error ? providerWaitSecs({ message: error.message, code: error.code }) : null;
    if (wait) return { step: 'code', email: email.data, error: TOO_MANY_CODES, retryAt: Date.now() + wait * 1000 };
    await recordAttempt(email.data, 'bad_code');
    const until = await attemptBlockedUntil(email.data, 'bad_code');
    return until
      ? { step: 'code', email: email.data, error: TOO_MANY_CODES, retryAt: until }
      : { step: 'code', email: email.data, error: friendly(error?.message ?? '') };
  }

  const { data: profile } = await supabase.from('profiles').select('username').eq('id', data.user.id).maybeSingle();
  const next = safeNext(String(form.get('next') ?? ''), HOME_AFTER_SIGN_IN);
  redirect(profile?.username ? next : `${USERNAME_PATH}?next=${encodeURIComponent(next)}`);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/');
}
