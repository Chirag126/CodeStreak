// Sponsorship amounts (pure). The program only requires amount > 0; these app limits keep typos
// ("10000000" instead of "10") and dust spam out. The server re-checks them and the wallet balance.

import { SOL_DECIMALS, USDC_DECIMALS } from './constants.js';
import { formatAmount, parseAmount } from './money.js';

export const SPONSOR_LIMITS = {
  usdc: { decimals: USDC_DECIMALS, min: '0.1', max: '10000', symbol: 'USDC', presets: ['1', '5', '10', '25'] },
  sol: { decimals: SOL_DECIMALS, min: '0.001', max: '100', symbol: 'SOL', presets: ['0.05', '0.1', '0.5', '1'] },
} as const;

export type SponsorToken = keyof typeof SPONSOR_LIMITS;

export const SPONSOR_MESSAGE_MAX = 140;

export type SponsorAmountResult = { ok: true; amount: bigint } | { ok: false; error: string };

export function parseSponsorAmount(raw: string, token: SponsorToken): SponsorAmountResult {
  const l = SPONSOR_LIMITS[token];
  const s = raw.trim();
  if (!s) return { ok: false, error: 'Enter an amount.' };
  let amount: bigint;
  try {
    amount = parseAmount(s, l.decimals);
  } catch {
    return { ok: false, error: /^\d*\.?\d*$/.test(s) ? `Use at most ${l.decimals} decimal places.` : `Enter a number like ${l.presets[1]}.` };
  }
  if (amount === 0n) return { ok: false, error: 'The amount must be more than zero.' };
  const min = parseAmount(l.min, l.decimals);
  const max = parseAmount(l.max, l.decimals);
  if (amount < min) return { ok: false, error: `The minimum is ${l.min} ${l.symbol}.` };
  if (amount > max) return { ok: false, error: `The maximum is ${formatAmount(max, l.decimals)} ${l.symbol} per sponsorship.` };
  return { ok: true, amount };
}

/** Trims, collapses whitespace and drops control characters; null when empty. Rejects over-long text. */
export function cleanSponsorMessage(raw: string | null | undefined): { ok: true; message: string | null } | { ok: false; error: string } {
  const visible = Array.from(raw ?? '', (ch) => {
    const code = ch.codePointAt(0)!;
    return code < 0x20 || code === 0x7f ? ' ' : ch; // control characters
  }).join('');
  const m = visible.replace(/\s+/g, ' ').trim();
  if (m.length > SPONSOR_MESSAGE_MAX) return { ok: false, error: `Keep the message under ${SPONSOR_MESSAGE_MAX} characters.` };
  return { ok: true, message: m || null };
}
