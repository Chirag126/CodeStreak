import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { getServerEnv } from '@/lib/env';

/**
 * Service-role client for server-side writes the user can't make directly (RLS has no write
 * policies). Only call it after identifying the user with getClaims(), and scope every query to
 * that user. Never import it from client code.
 */
export function createSupabaseAdminClient() {
  const env = getServerEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured');
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
