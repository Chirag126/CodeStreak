import 'server-only';

import { WIDGET_COLORS, type WidgetModel, type WidgetTheme } from '@codestreak/shared';
import { ImageResponse } from 'next/og';

// Phase 38: the PNG / JPG widget and the profile's social image, drawn with Next's ImageResponse
// (no extra dependency). Text only: no remote images are fetched, whatever the profile says.

function Stat({ value, label, c, big }: { value: string; label: string; c: (typeof WIDGET_COLORS)['dark']; big: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: big ? 64 : 30, fontWeight: 700, color: c.text }}>{value}</div>
      <div style={{ fontSize: big ? 24 : 13, color: c.muted }}>{label}</div>
    </div>
  );
}

/** One layout for both sizes: the 480×180 widget and the 1200×630 social card. */
function Card({ m, theme, big }: { m: WidgetModel; theme: WidgetTheme; big: boolean }) {
  const c = WIDGET_COLORS[theme];
  const pad = big ? 72 : 22;
  const brand = <div style={{ display: 'flex', fontSize: big ? 26 : 12, fontWeight: 700, letterSpacing: big ? 4 : 1.5, color: c.accent }}>CODESTREAK</div>;
  if (!m.found) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: c.card, color: c.text, fontFamily: 'sans-serif' }}>
        {brand}
        <div style={{ display: 'flex', marginTop: big ? 28 : 10, fontSize: big ? 52 : 20, fontWeight: 600 }}>Profile not found</div>
        <div style={{ display: 'flex', marginTop: big ? 12 : 4, fontSize: big ? 26 : 12, color: c.muted }}>This CodeStreak profile doesn&apos;t exist or isn&apos;t public.</div>
      </div>
    );
  }
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: pad, background: c.card, color: c.text, fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div
            style={{
              width: big ? 120 : 44,
              height: big ? 120 : 44,
              borderRadius: 9999,
              border: `2px solid ${c.border}`,
              background: c.bg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: big ? 44 : 15,
              fontWeight: 700,
            }}
          >
            {m.initials}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginLeft: big ? 32 : 12 }}>
            <div style={{ fontSize: big ? 56 : 18, fontWeight: 700 }}>{m.name}</div>
            <div style={{ fontSize: big ? 28 : 12, color: c.muted }}>{m.subtitle}</div>
          </div>
        </div>
        {brand}
      </div>
      <div style={{ display: 'flex', fontSize: big ? 36 : 14, fontWeight: 600, color: c.streak }}>{`${m.current} day${m.current === 1 ? '' : 's'} current streak`}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <Stat value={String(m.longest)} label="longest streak" c={c} big={big} />
        <Stat value={m.successRate} label="success rate" c={c} big={big} />
        <Stat value={m.survived} label="survived" c={c} big={big} />
        <Stat value={String(m.badges)} label={`badge${m.badges === 1 ? '' : 's'}`} c={c} big={big} />
      </div>
      <div style={{ display: 'flex', fontSize: big ? 22 : 10, color: c.muted }}>{`Earned ${m.earned} · Solana devnet`}</div>
    </div>
  );
}

export const OG_SIZE = { width: 1200, height: 630 } as const;

export function widgetImage(m: WidgetModel, theme: WidgetTheme, size: { width: number; height: number }, headers?: Record<string, string>): ImageResponse {
  return new ImageResponse(<Card m={m} theme={theme} big={size.width >= 1000} />, { ...size, headers });
}
