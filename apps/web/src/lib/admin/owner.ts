import 'server-only';

import { notFound } from 'next/navigation';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { isOwnerIdentity, isRecentSignIn, ownerConfigFromEnv } from './identity';

export interface Owner {
  id: string;
  email: string;
  lastSignInAt: string | null;
  recentSignIn: boolean;
}

/**
 * The server-side gate for every admin page, action and API. Verifies the session with Supabase
 * Auth (getUser hits the Auth server, so a revoked or forged token fails), then the owner identity
 * from the server environment, then the single owner row in the database. Returns null otherwise.
 */
export async function currentOwner(): Promise<Owner | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;
  if (error || !user) return null;
  if (!isOwnerIdentity({ id: user.id, email: user.email, emailConfirmedAt: user.email_confirmed_at }, ownerConfigFromEnv())) return null;
  // Third check: the database agrees (admin functions re-check this themselves too).
  const { data: row } = await createSupabaseAdminClient().from('admins').select('profile_id').eq('profile_id', user.id).maybeSingle();
  if (!row) return null;
  return { id: user.id, email: user.email!, lastSignInAt: user.last_sign_in_at ?? null, recentSignIn: isRecentSignIn(user.last_sign_in_at, Date.now()) };
}

/** Pages: anyone but the owner gets a plain 404 (the console does not reveal that it exists). */
export async function requireOwnerPage(): Promise<Owner> {
  const owner = await currentOwner();
  if (!owner) notFound();
  return owner;
}
