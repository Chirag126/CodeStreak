'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { HOME_AFTER_SIGN_IN, safeNext, USERNAME_PATH } from '@/lib/auth/routes';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export type SignInState =
  | { step: 'email'; error?: string; email?: string }
  | { step: 'code'; email: string; error?: string; notice?: string };

const emailSchema = z.email('Enter a valid email address.').max(254);
const codeSchema = z.string().trim().regex(/^\d{6,10}$/, 'Enter the code from the email (numbers only).');

function friendly(message: string): string {
  if (/rate limit|too many|for security purposes/i.test(message)) return 'Too many attempts. Wait a minute and try again.';
  if (/expired|invalid/i.test(message)) return 'That code is wrong or has expired. Request a new one.';
  return 'Something went wrong. Please try again.';
}

/** Step 1: email a one-time code (creates the account on first sign-in). */
export async function requestCode(_prev: SignInState, form: FormData): Promise<SignInState> {
  const parsed = emailSchema.safeParse(String(form.get('email') ?? '').trim().toLowerCase());
  if (!parsed.success) return { step: 'email', error: parsed.error.issues[0]?.message, email: String(form.get('email') ?? '') };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({ email: parsed.data, options: { shouldCreateUser: true } });
  if (error) return { step: 'email', error: friendly(error.message), email: parsed.data };
  return { step: 'code', email: parsed.data, notice: `We sent a code to ${parsed.data}.` };
}

/** Step 2: verify the code, then continue to the username step (new users) or where they were going. */
export async function verifyCode(_prev: SignInState, form: FormData): Promise<SignInState> {
  const email = emailSchema.safeParse(String(form.get('email') ?? ''));
  if (!email.success) return { step: 'email', error: 'Start again with your email.' };
  const code = codeSchema.safeParse(String(form.get('code') ?? ''));
  if (!code.success) return { step: 'code', email: email.data, error: code.error.issues[0]?.message };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.verifyOtp({ email: email.data, token: code.data, type: 'email' });
  if (error || !data.user) return { step: 'code', email: email.data, error: friendly(error?.message ?? '') };

  const { data: profile } = await supabase.from('profiles').select('username').eq('id', data.user.id).maybeSingle();
  const next = safeNext(String(form.get('next') ?? ''), HOME_AFTER_SIGN_IN);
  redirect(profile?.username ? next : `${USERNAME_PATH}?next=${encodeURIComponent(next)}`);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect('/');
}
