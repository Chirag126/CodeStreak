// Phase 39: Solana Actions (Blinks) for joining and sponsoring PUBLIC challenges. Pure pieces
// (headers, metadata, input checks) shared by the web routes and their tests.
// Spec: https://solana.com/docs/advanced/actions
import { TOKEN_DECIMALS, type Token } from './dashboard.js';
import { formatAmount } from './money.js';
import { parseSponsorAmount, SPONSOR_LIMITS } from './sponsor.js';

/** Devnet's genesis hash in CAIP-2 form: tells Blink clients which cluster the transactions are for. */
export const DEVNET_BLOCKCHAIN_ID = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
export const ACTION_VERSION = '2.4';

/** CORS and spec headers for every Actions response (GET, POST, OPTIONS, errors and actions.json). */
export const ACTION_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids',
  'Access-Control-Expose-Headers': 'X-Action-Version, X-Blockchain-Ids',
  'X-Action-Version': ACTION_VERSION,
  'X-Blockchain-Ids': DEVNET_BLOCKCHAIN_ID,
  'Content-Type': 'application/json',
};

export interface ActionError {
  message: string;
}

/** actions.json: challenge pages unfurl as the join Blink; the action API maps to itself. */
export function actionsJson() {
  return {
    rules: [
      { pathPattern: '/challenges/*', apiPath: '/api/actions/join/*' },
      { pathPattern: '/api/actions/**', apiPath: '/api/actions/**' },
    ],
  };
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A plausible base58 address (the web route still parses it into a PublicKey). */
export function looksLikeAddress(s: unknown): s is string {
  return typeof s === 'string' && BASE58.test(s);
}

/** The POST body: `{ account }`, the signing wallet. */
export function parseActionAccount(body: unknown): { ok: true; account: string } | { ok: false; error: string } {
  const account = (body as { account?: unknown } | null)?.account;
  if (!looksLikeAddress(account)) return { ok: false, error: 'Send the wallet address that will sign as "account".' };
  return { ok: true, account };
}

/** The sponsor amount from the Blink input, with the same limits as the app (decimal, e.g. "2.5"). */
export function parseActionAmount(raw: string | null, token: Token): { ok: true; amount: bigint } | { ok: false; error: string } {
  if (raw === null || raw.trim() === '') return { ok: false, error: 'Enter an amount to sponsor.' };
  const r = parseSponsorAmount(raw, token);
  return r.ok ? { ok: true, amount: r.amount } : { ok: false, error: r.error };
}

/** What a Blink needs to know about a challenge (from the database mirror, refreshed by the chain). */
export interface ActionChallenge {
  address: string;
  title: string;
  token: Token;
  buyIn: bigint;
  numDays: number;
  dayLengthSecs: number;
  players: number;
  maxPlayers: number;
  pool: bigint;
  providers: string[];
  joinOpen: boolean;
  sponsorOpen: boolean;
  isDemo: boolean;
}

const amountText = (v: bigint, t: Token) => `${formatAmount(v, TOKEN_DECIMALS[t])} ${t.toUpperCase()}`;
const dayText = (secs: number) => (secs >= 86_400 ? 'days' : `"days" of ${Math.round(secs / 60)} min (demo)`);

function description(c: ActionChallenge, extra: string): string {
  const proof = c.providers.length ? `Proof: ${c.providers.join(' or ')} activity each day, checked automatically.` : '';
  return [
    `${c.numDays} ${dayText(c.dayLengthSecs)} of coding. Buy-in ${amountText(c.buyIn, c.token)}; pool ${amountText(c.pool, c.token)}; ${c.players}/${c.maxPlayers} players.`,
    proof,
    extra,
    'Solana devnet: test tokens with no real value.',
  ]
    .filter(Boolean)
    .join(' ');
}

/** GET metadata for the join Blink. */
export function joinActionMetadata(c: ActionChallenge, origin: string, icon: string) {
  const full = c.players >= c.maxPlayers;
  const reason = !c.joinOpen ? 'Joining has closed for this challenge.' : full ? 'This challenge is full.' : null;
  return {
    type: 'action' as const,
    icon,
    title: `CodeStreak: ${c.title}`,
    description: description(
      c,
      `Survivors split the pool. Needs a wallet linked to a CodeStreak account with the coding accounts above. Rules: ${origin}/challenges/${c.address}`,
    ),
    label: `Join for ${amountText(c.buyIn, c.token)}`,
    disabled: Boolean(reason),
    ...(reason ? { error: { message: reason } } : {}),
    links: { actions: [{ type: 'transaction' as const, label: `Join for ${amountText(c.buyIn, c.token)}`, href: `/api/actions/join/${c.address}` }] },
  };
}

/** GET metadata for the sponsor Blink: preset buttons plus a custom amount. */
export function sponsorActionMetadata(c: ActionChallenge, icon: string) {
  const l = SPONSOR_LIMITS[c.token];
  const href = (amount: string) => `/api/actions/sponsor/${c.address}?amount=${amount}`;
  return {
    type: 'action' as const,
    icon,
    title: `Sponsor: ${c.title}`,
    description: description(c, 'Sponsoring adds to the reward pool for the players who keep their streak; it is refunded if nobody survives or the challenge is cancelled.'),
    label: 'Sponsor',
    disabled: !c.sponsorOpen,
    ...(c.sponsorOpen ? {} : { error: { message: 'Sponsoring closes when the challenge ends.' } }),
    links: {
      actions: [
        ...l.presets.slice(0, 3).map((p) => ({ type: 'transaction' as const, label: `${p} ${l.symbol}`, href: href(p) })),
        {
          type: 'transaction' as const,
          label: 'Sponsor',
          href: href('{amount}'),
          parameters: [{ type: 'number' as const, name: 'amount', label: `Amount (${l.symbol}, ${l.min}–${l.max})`, required: true, min: Number(l.min), max: Number(l.max) }],
        },
      ],
    },
  };
}
