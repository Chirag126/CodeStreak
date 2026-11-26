import { isSolanaAddress } from '@codestreak/shared/wallet';
import { NextResponse, type NextRequest } from 'next/server';
import { nowSecs } from '@/lib/insights/load';
import { loadLeaderboards } from '@/lib/leaderboards/load';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { PUBLIC_READ, overLimit, tooManyRequests } from '@/lib/http/rate-limit';

export const dynamic = 'force-dynamic';

/** Leaderboards for the viewer (global, or ?group=<challenge address>), re-fetched on each change. */
export async function GET(req: NextRequest) {
  const wait = overLimit(req, PUBLIC_READ);
  if (wait) return tooManyRequests(wait);
  const group = req.nextUrl.searchParams.get('group') ?? undefined;
  if (group && !isSolanaAddress(group)) return NextResponse.json({ error: 'Not a challenge address.' }, { status: 400 });
  const data = await loadLeaderboards(await createSupabaseServerClient(), nowSecs(), group);
  if (!data) return NextResponse.json({ error: 'Challenge not found, or it is a private group you are not in.' }, { status: 404 });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
}
