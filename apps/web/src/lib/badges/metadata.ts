// Phase 34: the off-chain half of a soulbound badge. The mint's on-chain metadata (Token-2022
// metadata extension) holds name, symbol and a URI fixed by the program:
//   https://codestreak-k0uv.onrender.com/api/badges/<participant>
// Wallets and explorers fetch that URI for the description, image and attributes built here.
// Pure, so it is unit-tested; the route only loads the row.

export interface BadgeMetadataRow {
  username: string | null;
  wallet: string;
  challenge_title: string;
  /** Null for private challenges (not linked). */
  challenge_address: string | null;
  num_days: number;
  finished_at: string;
  mint: string | null;
  mint_tx: string | null;
}

/** The name the program writes on-chain (`CodeStreak Survivor · N days`); kept in sync here. */
export function badgeName(numDays: number): string {
  return `CodeStreak Survivor · ${numDays} days`;
}

export const BADGE_SYMBOL = 'STREAK';

export function badgeMetadataJson(row: BadgeMetadataRow, origin: string, participant: string) {
  const who = row.username ? `@${row.username}` : `${row.wallet.slice(0, 4)}…${row.wallet.slice(-4)}`;
  const day = row.finished_at.slice(0, 10);
  return {
    name: badgeName(row.num_days),
    symbol: BADGE_SYMBOL,
    description: `${who} kept a ${row.num_days}-day coding streak in “${row.challenge_title}” on CodeStreak. Soulbound: this token cannot be transferred or sold. Solana devnet.`,
    image: `${origin}/api/badges/${participant}/image`,
    external_url: row.challenge_address ? `${origin}/challenges/${row.challenge_address}` : origin,
    attributes: [
      { trait_type: 'Days', value: row.num_days },
      { trait_type: 'Challenge', value: row.challenge_title },
      { trait_type: 'Finished', value: day },
      { trait_type: 'Soulbound', value: 'Yes' },
      { trait_type: 'Network', value: 'Solana devnet' },
    ],
    properties: { category: 'image', files: [{ uri: `${origin}/api/badges/${participant}/image`, type: 'image/png' }] },
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A self-contained SVG medal (no external fonts or images), with every user string escaped. */
export function badgeSvg(row: Pick<BadgeMetadataRow, 'username' | 'num_days' | 'challenge_title' | 'finished_at'>): string {
  const title = row.challenge_title.length > 34 ? `${row.challenge_title.slice(0, 33)}…` : row.challenge_title;
  const who = row.username ? `@${row.username}` : 'Survivor';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="${esc(badgeName(row.num_days))}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1120"/><stop offset="1" stop-color="#1e293b"/></linearGradient>
<linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbbf24"/><stop offset="1" stop-color="#f97316"/></linearGradient></defs>
<rect width="512" height="512" rx="48" fill="url(#g)"/>
<circle cx="256" cy="212" r="132" fill="none" stroke="url(#r)" stroke-width="14"/>
<text x="256" y="236" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="112" font-weight="800" fill="#f8fafc">${row.num_days}</text>
<text x="256" y="282" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="26" font-weight="600" fill="#fbbf24" letter-spacing="6">DAYS</text>
<text x="256" y="396" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="30" font-weight="700" fill="#f8fafc">${esc(who)}</text>
<text x="256" y="434" text-anchor="middle" font-family="ui-sans-serif,system-ui,sans-serif" font-size="20" fill="#94a3b8">${esc(title)}</text>
<text x="256" y="474" text-anchor="middle" font-family="ui-monospace,monospace" font-size="15" fill="#64748b" letter-spacing="3">CODESTREAK · SOULBOUND · ${esc(row.finished_at.slice(0, 10))}</text>
</svg>`;
}
