import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getPublicEnv } from '@/lib/env';

/**
 * Supabase client for server components, server actions and route handlers, acting as the signed-in
 * user (publishable key + the user's session cookie; RLS applies). Never uses the service role.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const env = getPublicEnv();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options);
        } catch {
          // Called from a server component, where cookies are read-only. The proxy refreshes sessions.
        }
      },
    },
  });
}

export interface Viewer {
  userId: string;
  email: string | null;
  publicId: string;
  username: string | null;
  displayName: string | null;
}

/** The signed-in user and their profile, or null. Verifies the session token (getClaims). */
export async function getViewer(): Promise<Viewer | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('public_id, username, display_name')
    .eq('id', claims.sub)
    .maybeSingle();
  if (!profile) return null;
  return {
    userId: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : null,
    publicId: profile.public_id as string,
    username: (profile.username as string | null) ?? null,
    displayName: (profile.display_name as string | null) ?? null,
  };
}
