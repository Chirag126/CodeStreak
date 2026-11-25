// Phase 38: the embeddable profile widget (SVG, standalone HTML) and the data behind the PNG/JPG
// cards. Pure: the web app loads the public profile (which already hides private-group details and
// hidden / banned accounts) and passes it in. Nothing here fetches, so it can't be made to reach
// arbitrary URLs (no avatars: initials only).
import { TOKEN_DECIMALS, type Token } from './dashboard.js';
import { formatAmount } from './money.js';

export type WidgetTheme = 'dark' | 'light';
export const WIDGET_FORMATS = ['svg', 'png', 'jpg'] as const;
export type WidgetFormat = (typeof WIDGET_FORMATS)[number];

/** What the widget needs from a public profile (a subset of PublicProfile). */
export interface WidgetProfileInput {
  username: string;
  displayName: string | null;
  stats: { currentStreak: number; longestStreak: number; successRate: number | null; survived: number; finished: number; earned: Partial<Record<Token, bigint>> };
  badges: unknown[];
}

export type WidgetModel =
  | {
      found: true;
      username: string;
      /** Display name only when it is plain printable text (image renderers lack other glyphs). */
      name: string;
      initials: string;
      current: number;
      longest: number;
      successRate: string;
      survived: string;
      badges: number;
      earned: string;
    }
  | { found: false };

const PRINTABLE = /^[\x20-\x7E\u00A0-\u024F]+$/;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function widgetModel(p: WidgetProfileInput | null): WidgetModel {
  if (!p) return { found: false };
  const display = p.displayName?.trim();
  const name = clip(display && PRINTABLE.test(display) ? display : `@${p.username}`, 28);
  const earned = (Object.entries(p.stats.earned) as [Token, bigint][])
    .filter(([, v]) => v > 0n)
    .map(([t, v]) => `${formatAmount(v, TOKEN_DECIMALS[t])} ${t.toUpperCase()}`)
    .join(' · ');
  return {
    found: true,
    username: p.username,
    name,
    initials: (display && PRINTABLE.test(display) ? display : p.username).slice(0, 2).toUpperCase(),
    current: p.stats.currentStreak,
    longest: p.stats.longestStreak,
    successRate: p.stats.successRate === null ? '—' : `${p.stats.successRate}%`,
    survived: `${p.stats.survived}/${p.stats.finished}`,
    badges: p.badges.length,
    earned: earned || '—',
  };
}

/** Parses "<username>.<svg|png|jpg|jpeg>" (the widget URL's last segment). */
export function parseWidgetFile(raw: string): { username: string; format: WidgetFormat } | null {
  let s: string;
  try {
    s = decodeURIComponent(raw).trim().toLowerCase();
  } catch {
    return null;
  }
  const m = /^@?([a-z0-9_]{3,20})\.(svg|png|jpe?g)$/.exec(s);
  if (!m) return null;
  return { username: m[1]!, format: m[2] === 'svg' ? 'svg' : m[2] === 'png' ? 'png' : 'jpg' };
}

export function widgetTheme(raw: string | null | undefined): WidgetTheme {
  return raw === 'light' ? 'light' : 'dark';
}

export const WIDGET_COLORS: Record<WidgetTheme, { bg: string; card: string; border: string; text: string; muted: string; accent: string; streak: string }> = {
  dark: { bg: '#0b1120', card: '#111827', border: '#1f2937', text: '#f8fafc', muted: '#94a3b8', accent: '#a3e635', streak: '#f59e0b' },
  light: { bg: '#ffffff', card: '#f8fafc', border: '#e2e8f0', text: '#0f172a', muted: '#475569', accent: '#4d7c0f', streak: '#d97706' },
};

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
export const WIDGET_SIZE = { width: 480, height: 180 } as const;

/** The widget as a self-contained SVG (no scripts, no external resources). */
export function widgetSvg(m: WidgetModel, theme: WidgetTheme = 'dark'): string {
  const c = WIDGET_COLORS[theme];
  const { width: w, height: h } = WIDGET_SIZE;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img"`;
  const frame = `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="${c.card}" stroke="${c.border}"/>`;
  const brand = `<text x="${w - 20}" y="30" text-anchor="end" font-size="12" font-weight="700" fill="${c.accent}" letter-spacing="1.5">CODESTREAK</text>`;
  if (!m.found) {
    return [
      `${open} aria-label="CodeStreak profile not found"><title>CodeStreak profile not found</title>`,
      `<g font-family="${FONT}">`,
      frame,
      brand,
      `<text x="${w / 2}" y="${h / 2 - 4}" text-anchor="middle" font-size="18" font-weight="600" fill="${c.text}">Profile not found</text>`,
      `<text x="${w / 2}" y="${h / 2 + 20}" text-anchor="middle" font-size="13" fill="${c.muted}">This CodeStreak profile doesn't exist or isn't public.</text>`,
      '</g></svg>',
    ].join('');
  }
  const label = `${m.name} on CodeStreak: ${m.current}-day streak, longest ${m.longest}, ${m.successRate} success`;
  const stat = (x: number, value: string, caption: string) =>
    `<text x="${x}" y="128" font-size="22" font-weight="700" fill="${c.text}">${escapeXml(value)}</text><text x="${x}" y="148" font-size="11" fill="${c.muted}">${caption}</text>`;
  return [
    `${open} aria-label="${escapeXml(label)}"><title>${escapeXml(label)}</title>`,
    `<g font-family="${FONT}">`,
    frame,
    brand,
    `<circle cx="44" cy="46" r="22" fill="${c.bg}" stroke="${c.border}"/>`,
    `<text x="44" y="51" text-anchor="middle" font-size="14" font-weight="700" fill="${c.text}">${escapeXml(m.initials)}</text>`,
    `<text x="78" y="42" font-size="17" font-weight="700" fill="${c.text}">${escapeXml(m.name)}</text>`,
    `<text x="78" y="61" font-size="12" fill="${c.muted}">@${escapeXml(m.username)}</text>`,
    `<text x="20" y="98" font-size="13" fill="${c.streak}" font-weight="600">🔥 ${m.current} day${m.current === 1 ? '' : 's'} current streak</text>`,
    stat(20, String(m.longest), 'longest streak'),
    stat(130, m.successRate, 'success rate'),
    stat(240, m.survived, 'survived'),
    stat(340, String(m.badges), `badge${m.badges === 1 ? '' : 's'}`),
    `<text x="20" y="${h - 12}" font-size="10" fill="${c.muted}">Earned ${escapeXml(m.earned)} · Solana devnet</text>`,
    '</g></svg>',
  ].join('');
}

/**
 * The iframe widget: a complete HTML page (inline CSS, no JavaScript) showing the SVG card and
 * linking to the profile in a new tab.
 */
export function widgetHtml(m: WidgetModel, theme: WidgetTheme, origin: string): string {
  const c = WIDGET_COLORS[theme];
  const href = m.found ? `${origin}/u/${encodeURIComponent(m.username)}` : origin;
  const title = m.found ? `${m.name} on CodeStreak` : 'CodeStreak profile not found';
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeXml(title)}</title>`,
    `<style>html,body{margin:0;padding:0;background:transparent}a{display:block;max-width:${WIDGET_SIZE.width}px;line-height:0;border-radius:14px;outline-offset:2px}a:focus-visible{outline:2px solid ${c.accent}}svg{width:100%;height:auto}</style>`,
    '</head><body>',
    `<a href="${escapeXml(href)}" target="_blank" rel="noopener noreferrer" title="${escapeXml(title)}">${widgetSvg(m, theme)}</a>`,
    '</body></html>',
  ].join('');
}

/** Ready-to-paste snippets for a profile's widget. */
export function widgetSnippets(origin: string, username: string, theme: WidgetTheme = 'dark') {
  const q = theme === 'light' ? '?theme=light' : '';
  const profile = `${origin}/u/${username}`;
  const svg = `${origin}/api/widget/${username}.svg${q}`;
  return {
    iframe: `<iframe src="${origin}/embed/${username}${q}" width="${WIDGET_SIZE.width}" height="${WIDGET_SIZE.height}" style="border:0;max-width:100%" title="${username} on CodeStreak" loading="lazy"></iframe>`,
    html: `<a href="${profile}"><img src="${svg}" width="${WIDGET_SIZE.width}" height="${WIDGET_SIZE.height}" alt="${username} on CodeStreak"></a>`,
    markdown: `[![${username} on CodeStreak](${svg})](${profile})`,
    svg,
    png: `${origin}/api/widget/${username}.png${q}`,
    jpg: `${origin}/api/widget/${username}.jpg${q}`,
  };
}
