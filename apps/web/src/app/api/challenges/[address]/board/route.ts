import { isSolanaAddress } from '@codestreak/shared/wallet';
import { NextResponse, type NextRequest } from 'next/server';
import { loadBoard } from '@/lib/board/load';
import { PUBLIC_READ, overLimit, tooManyRequests } from '@/lib/http/rate-limit';

export const dynamic = 'force-dynamic';

/** The group board for the signed-in viewer (or a guest), re-fetched by browsers on each change. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const wait = overLimit(req, PUBLIC_READ);
  if (wait) return tooManyRequests(wait);
  const { address } = await params;
  if (!isSolanaAddress(address)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const board = await loadBoard(address);
  if (!board) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(board, { headers: { 'Cache-Control': 'private, no-store' } });
}
