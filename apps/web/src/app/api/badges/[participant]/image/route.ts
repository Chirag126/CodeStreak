import { type NextRequest } from 'next/server';
import { badgeSvg } from '@/lib/badges/metadata';
import { loadBadgeMetadata } from '../load';

export const dynamic = 'force-dynamic';

/** The badge artwork (SVG). Public, like the metadata JSON. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ participant: string }> }) {
  const { participant } = await params;
  const row = await loadBadgeMetadata(participant);
  if (!row) return new Response('No badge for this participant.', { status: 404 });
  return new Response(badgeSvg(row), {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
      // An SVG served as a document must not run anything.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}
