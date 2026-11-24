import { filterHistory, historyCsv, parseHistoryFilters } from '@codestreak/shared';
import { NextResponse, type NextRequest } from 'next/server';
import { loadHistory } from '@/lib/history/load';
import { nowSecs } from '@/lib/insights/load';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Your history as CSV (same filters as the page). Only your own rows, read with your session. */
export async function GET(req: NextRequest) {
  const viewer = await getViewer();
  if (!viewer) return NextResponse.json({ error: 'Sign in to export your history.' }, { status: 401 });
  const filters = parseHistoryFilters(Object.fromEntries(req.nextUrl.searchParams));
  const rows = filterHistory(await loadHistory(await createSupabaseServerClient(), viewer.userId, nowSecs()), filters);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(historyCsv(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="codestreak-history-${viewer.username ?? 'me'}-${day}.csv"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
