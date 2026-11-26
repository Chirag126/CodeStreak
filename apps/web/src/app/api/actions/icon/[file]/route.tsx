import { formatAmount, TOKEN_DECIMALS } from '@codestreak/shared';
import { ImageResponse } from 'next/og';
import { type NextRequest } from 'next/server';
import { loadActionChallenge } from '@/lib/actions/challenge';
import { nowSecs } from '@/lib/insights/load';
import { PUBLIC_READ, overLimit, tooManyRequests } from '@/lib/http/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Phase 39: the Blink icon for a public challenge, 600×600 PNG (the Actions spec allows PNG, SVG or
 * WebP). Unknown or private challenges get the plain CodeStreak mark, never their details.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const wait = overLimit(req, PUBLIC_READ);
  if (wait) return tooManyRequests(wait);
  const address = (await params).file.replace(/\.png$/i, '');
  const c = await loadActionChallenge(address, nowSecs()).catch(() => null);
  const title = c ? (c.title.length > 40 ? `${c.title.slice(0, 39)}…` : c.title) : null;
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #0b1120, #111827)', color: '#f8fafc', fontFamily: 'sans-serif', padding: 48 }}>
        <div style={{ display: 'flex', fontSize: 30, fontWeight: 700, letterSpacing: 6, color: '#a3e635' }}>CODESTREAK</div>
        {c ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ display: 'flex', marginTop: 40, width: 220, height: 220, borderRadius: 9999, border: '14px solid #f59e0b', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ display: 'flex', fontSize: 96, fontWeight: 800, lineHeight: 1 }}>{String(c.numDays)}</div>
              <div style={{ display: 'flex', fontSize: 24, color: '#fbbf24', letterSpacing: 5 }}>{c.dayLengthSecs >= 86_400 ? 'DAYS' : 'DEMO DAYS'}</div>
            </div>
            <div style={{ display: 'flex', marginTop: 36, fontSize: 36, fontWeight: 700, textAlign: 'center' }}>{title}</div>
            <div style={{ display: 'flex', marginTop: 12, fontSize: 26, color: '#94a3b8' }}>{`Buy-in ${formatAmount(c.buyIn, TOKEN_DECIMALS[c.token])} ${c.token.toUpperCase()} · ${c.players}/${c.maxPlayers} players`}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', marginTop: 32, fontSize: 36, color: '#94a3b8' }}>Coding streaks on Solana</div>
        )}
        <div style={{ display: 'flex', marginTop: 36, fontSize: 20, color: '#64748b', letterSpacing: 3 }}>SOLANA DEVNET</div>
      </div>
    ),
    { width: 600, height: 600, headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } },
  );
}
