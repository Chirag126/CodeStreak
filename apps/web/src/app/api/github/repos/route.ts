import { NextResponse } from 'next/server';
import { listOwnPublicRepos } from '@/lib/github/repos';
import { PUBLIC_READ, takeToken, tooManyRequests } from '@/lib/http/rate-limit';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

// The signed-in user's own public GitHub repositories, for the repository picker. Only their own
// linked account is ever read; the server's GitHub token never leaves the server.
export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store' };

export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'Sign in to see your repositories.' }, { status: 401, headers: noStore });
  const wait = takeToken(`github-repos:${viewer.userId}`, PUBLIC_READ);
  if (wait) return tooManyRequests(wait);

  const page = Number(new URL(req.url).searchParams.get('page') ?? '1');
  if (!Number.isInteger(page) || page < 1 || page > 10) return NextResponse.json({ error: 'Invalid page.' }, { status: 400, headers: noStore });

  const supabase = await createSupabaseServerClient();
  const { data: account } = await supabase.from('linked_accounts').select('provider_user_id').eq('profile_id', viewer.userId).eq('provider', 'github').maybeSingle();
  if (!account) return NextResponse.json({ error: 'Link your GitHub account first (Dashboard → Settings).', code: 'github.not_linked' }, { status: 409, headers: noStore });

  const result = await listOwnPublicRepos(Number(account.provider_user_id), page);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502, headers: noStore });
  return NextResponse.json({ repos: result.repos, hasMore: result.hasMore, page }, { headers: noStore });
}
