import { NextResponse, type NextRequest } from 'next/server';
import { appOrigin } from '@/lib/app-origin';
import { badgeMetadataJson } from '@/lib/badges/metadata';
import { loadBadgeMetadata } from './load';

export const dynamic = 'force-dynamic';

/** The JSON a badge's on-chain metadata URI points to (read by wallets and explorers). Public. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ participant: string }> }) {
  const { participant } = await params;
  const row = await loadBadgeMetadata(participant);
  if (!row) return NextResponse.json({ error: 'No badge for this participant: only players who survived a challenge have one.' }, { status: 404 });
  return NextResponse.json(badgeMetadataJson(row, appOrigin(req.nextUrl.origin), participant), {
    headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' },
  });
}
