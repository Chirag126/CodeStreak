import { describe, expect, it } from 'vitest';
import { cleanSponsorMessage, parseSponsorAmount } from './sponsor.js';

describe('sponsor amounts', () => {
  it('accepts amounts within the limits', () => {
    expect(parseSponsorAmount('5', 'usdc')).toEqual({ ok: true, amount: 5_000_000n });
    expect(parseSponsorAmount(' 0.25 ', 'usdc')).toEqual({ ok: true, amount: 250_000n });
    expect(parseSponsorAmount('0.05', 'sol')).toEqual({ ok: true, amount: 50_000_000n });
    expect(parseSponsorAmount('10000', 'usdc')).toEqual({ ok: true, amount: 10_000_000_000n });
  });

  it('rejects zero, blank and negative amounts', () => {
    for (const s of ['0', '0.0', '0.000000']) expect(parseSponsorAmount(s, 'usdc')).toEqual({ ok: false, error: 'The amount must be more than zero.' });
    expect(parseSponsorAmount('', 'usdc').ok).toBe(false);
    expect(parseSponsorAmount('-5', 'usdc').ok).toBe(false);
    expect(parseSponsorAmount('abc', 'sol').ok).toBe(false);
  });

  it('rejects too-large amounts (and u64-overflowing input) and dust', () => {
    expect(parseSponsorAmount('10000.000001', 'usdc')).toEqual({ ok: false, error: 'The maximum is 10000 USDC per sponsorship.' });
    expect(parseSponsorAmount('101', 'sol').ok).toBe(false);
    expect(parseSponsorAmount('99999999999999999999999', 'usdc').ok).toBe(false);
    expect(parseSponsorAmount('0.01', 'usdc')).toEqual({ ok: false, error: 'The minimum is 0.1 USDC.' });
  });

  it('rejects too many decimals', () => {
    expect(parseSponsorAmount('1.1234567', 'usdc')).toEqual({ ok: false, error: 'Use at most 6 decimal places.' });
  });
});

describe('sponsor messages', () => {
  it('cleans and limits messages', () => {
    expect(cleanSponsorMessage('  Go   team!\n')).toEqual({ ok: true, message: 'Go team!' });
    expect(cleanSponsorMessage('')).toEqual({ ok: true, message: null });
    expect(cleanSponsorMessage('x'.repeat(141)).ok).toBe(false);
  });
});
