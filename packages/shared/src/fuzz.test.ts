// Phase 41.1: input fuzzing. Every parser that sees untrusted input (form fields, query strings,
// Blink bodies, URL segments) gets thousands of random and hostile strings. Each must answer with a
// result object (never throw, unless throwing is its documented contract), and whatever it accepts
// must satisfy the same rules the happy-path tests check. Seeded, so a failure reproduces exactly.
import { describe, expect, it } from 'vitest';
import { looksLikeAddress, parseActionAccount, parseActionAmount } from './actions.js';
import { parseFileFilter, parseRepoList } from './challenge-form.js';
import { parseHistoryFilters } from './history.js';
import { formatAmount, parseAmount } from './money.js';
import { cleanSponsorMessage, parseSponsorAmount, SPONSOR_LIMITS, SPONSOR_MESSAGE_MAX, type SponsorToken } from './sponsor.js';
import { RESERVED_USERNAMES, USERNAME_PATTERN, usernameSchema } from './username.js';
import { isSolanaAddress } from './wallet/index.js';
import { parseWidgetFile } from './widget.js';

const RUNS = 3000;

/** mulberry32: small seeded PRNG. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  '0', '1', '9', '.', '..', '-', '+', 'e', 'E', ' ', '\t', '\n', '\u0000', '\u007f', '​', ' ', '١', '٣', // Arabic-Indic digits
  'a', 'Z', '_', '@', '/', '\\', '%', '%2e', '%00', '%zz', '..', 'http://', 'github.com/', '.git', '"', "'", '<script>', '${x}',
  'NaN', 'Infinity', '0x1f', '1e9', '٫', '，', '💥', '𝟙', 'ß', 'İ', '.svg', '.png', '.jpg', '.jpeg', 'admin', 'chirag',
  '1111111111111111111111111111111', '9'.repeat(40), 'So11111111111111111111111111111111111111112',
];

function fuzzString(r: () => number): string {
  const n = Math.floor(r() * 12);
  let s = '';
  for (let i = 0; i < n; i++) {
    const roll = r();
    if (roll < 0.6) s += PIECES[Math.floor(r() * PIECES.length)];
    else if (roll < 0.9) s += String.fromCharCode(32 + Math.floor(r() * 95));
    else s += String.fromCodePoint(Math.floor(r() * 0x2ffff));
  }
  return r() < 0.02 ? s.repeat(500) : s; // sometimes very long
}

function fuzzValue(r: () => number): unknown {
  const roll = r();
  if (roll < 0.5) return fuzzString(r);
  if (roll < 0.6) return null;
  if (roll < 0.7) return undefined;
  if (roll < 0.8) return Math.floor(r() * 1e9) - 5e8;
  if (roll < 0.9) return [fuzzString(r)];
  return { toString: () => 'x', account: fuzzString(r) };
}

function each(seed: number, fn: (input: string, r: () => number) => void) {
  const r = rng(seed);
  for (let i = 0; i < RUNS; i++) fn(fuzzString(r), r);
}

describe('fuzz: money and sponsorship amounts', () => {
  it('parseAmount either throws its documented error or returns non-negative base units that round-trip', () => {
    each(1, (s) => {
      let v: bigint;
      try {
        v = parseAmount(s, 6);
      } catch (e) {
        expect((e as Error).message).toMatch(/^Invalid amount/);
        return;
      }
      expect(v >= 0n).toBe(true);
      expect(parseAmount(formatAmount(v, 6), 6)).toBe(v);
    });
  });

  it.each(['usdc', 'sol'] as SponsorToken[])('parseSponsorAmount (%s) never throws and accepts only amounts within the limits', (token) => {
    const l = SPONSOR_LIMITS[token];
    const [min, max] = [parseAmount(l.min, l.decimals), parseAmount(l.max, l.decimals)];
    each(2, (s) => {
      const res = parseSponsorAmount(s, token);
      if (res.ok) expect(res.amount >= min && res.amount <= max).toBe(true);
      else expect(res.error.length).toBeGreaterThan(0);
      const a = parseActionAmount(s, token);
      expect(a.ok).toBe(res.ok && s.trim() !== '');
    });
    expect(parseActionAmount(null, token).ok).toBe(false);
  });

  it('cleanSponsorMessage never lets control characters or over-long text through', () => {
    each(3, (s) => {
      const res = cleanSponsorMessage(s);
      if (!res.ok) return;
      if (res.message === null) return;
      expect(res.message.length).toBeLessThanOrEqual(SPONSOR_MESSAGE_MAX);
      expect([...res.message].some((ch) => ch.codePointAt(0)! < 0x20 || ch.codePointAt(0) === 0x7f)).toBe(false);
      expect(res.message).toBe(res.message.trim());
    });
  });
});

describe('fuzz: names, addresses and URL segments', () => {
  it('usernameSchema accepts only valid, unreserved names', () => {
    each(4, (s) => {
      const res = usernameSchema.safeParse(s);
      if (!res.success) return;
      expect(USERNAME_PATTERN.test(res.data)).toBe(true);
      expect(RESERVED_USERNAMES.has(res.data)).toBe(false);
    });
  });

  it('parseWidgetFile never throws and returns only valid usernames and known formats', () => {
    each(5, (s) => {
      const res = parseWidgetFile(s);
      if (!res) return;
      expect(USERNAME_PATTERN.test(res.username)).toBe(true);
      expect(['svg', 'png', 'jpg']).toContain(res.format);
    });
  });

  it('address checks never throw, and anything accepted is base58 of the right shape', () => {
    const r = rng(6);
    for (let i = 0; i < RUNS; i++) {
      const v = fuzzValue(r);
      const loose = looksLikeAddress(v);
      if (loose) expect(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v as string)).toBe(true);
      if (typeof v === 'string' && isSolanaAddress(v)) expect(loose).toBe(true);
      const body = parseActionAccount(r() < 0.5 ? v : { account: v });
      if (body.ok) expect(looksLikeAddress(body.account)).toBe(true);
    }
  });
});

describe('fuzz: challenge form and filters', () => {
  it('parseRepoList accepts only owner/name pairs without path tricks', () => {
    each(7, (s) => {
      const res = parseRepoList(s);
      if (!res.ok) return;
      for (const repo of res.repos) {
        expect(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(repo)).toBe(true);
        expect(repo.includes('/..') || repo.endsWith('/.')).toBe(false);
      }
    });
  });

  it('parseFileFilter returns dotted lowercase extensions and safe file names', () => {
    each(8, (s) => {
      const res = parseFileFilter(s);
      if (!res.ok) return;
      for (const e of res.extensions) expect(/^\.[a-z0-9]{1,10}$/.test(e)).toBe(true);
      for (const f of res.filenames) expect(/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$/.test(f)).toBe(true);
    });
  });

  it('parseHistoryFilters never throws on arbitrary query objects', () => {
    const r = rng(9);
    for (let i = 0; i < RUNS; i++) {
      const q: Record<string, string | string[] | undefined> = {};
      for (const k of ['kind', 'token', 'status', 'from', 'to', 'page', 'q', fuzzString(r)]) {
        const v = fuzzValue(r);
        q[k] = typeof v === 'string' || v === undefined ? v : [String(v)];
      }
      expect(() => parseHistoryFilters(q)).not.toThrow();
    }
  });
});
