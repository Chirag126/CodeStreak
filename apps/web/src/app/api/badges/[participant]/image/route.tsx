import { ImageResponse } from 'next/og';
import { type NextRequest } from 'next/server';
import { loadBadgeMetadata } from '../load';

export const dynamic = 'force-dynamic';

/**
 * The badge artwork as a 512×512 PNG. Wallets and marketplaces render PNG; many refuse SVG.
 * Public, like the metadata JSON. Built with Next's ImageResponse (no extra dependency).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ participant: string }> }) {
  const { participant } = await params;
  const row = await loadBadgeMetadata(participant);
  if (!row) return new Response('No badge for this participant.', { status: 404 });
  const title = row.challenge_title.length > 34 ? `${row.challenge_title.slice(0, 33)}…` : row.challenge_title;
  const who = row.username ? `@${row.username}` : 'Survivor';
  const image = new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0b1120, #1e293b)',
          color: '#f8fafc',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            width: 270,
            height: 270,
            borderRadius: 9999,
            border: '14px solid #f59e0b',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div style={{ fontSize: 112, fontWeight: 800, lineHeight: 1 }}>{String(row.num_days)}</div>
          <div style={{ fontSize: 26, fontWeight: 600, color: '#fbbf24', letterSpacing: 6 }}>DAYS</div>
        </div>
        <div style={{ marginTop: 34, fontSize: 32, fontWeight: 700 }}>{who}</div>
        <div style={{ marginTop: 8, fontSize: 20, color: '#94a3b8' }}>{title}</div>
        <div style={{ marginTop: 22, fontSize: 15, color: '#64748b', letterSpacing: 3 }}>{`CODESTREAK · SOULBOUND · ${row.finished_at.slice(0, 10)}`}</div>
      </div>
    ),
    { width: 512, height: 512 },
  );
  image.headers.set('Cache-Control', 'public, max-age=3600');
  image.headers.set('Access-Control-Allow-Origin', '*');
  return image;
}
