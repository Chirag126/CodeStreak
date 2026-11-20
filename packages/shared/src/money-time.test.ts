import { describe, expect, it } from 'vitest';
import { formatAmount, parseAmount } from './money.js';
import { dayIndexAt, dayWindow, nextUtcMidnight, utcDateString } from './time.js';

describe('money (integer base units)', () => {
  it('parses decimal strings exactly', () => {
    expect(parseAmount('12.5', 6)).toBe(12_500_000n);
    expect(parseAmount('0.000001', 6)).toBe(1n);
    expect(parseAmount('10', 9)).toBe(10_000_000_000n);
    expect(parseAmount(' 3 ', 0)).toBe(3n);
  });

  it('rejects bad input instead of rounding', () => {
    expect(() => parseAmount('1.0000001', 6)).toThrow(/decimal places/);
    expect(() => parseAmount('-1', 6)).toThrow();
    expect(() => parseAmount('1e3', 6)).toThrow();
    expect(() => parseAmount('', 6)).toThrow();
  });

  it('formats without floating point', () => {
    expect(formatAmount(12_500_000n, 6)).toBe('12.5');
    expect(formatAmount(10_000_000n, 6, 2)).toBe('10.00');
    expect(formatAmount(1n, 9)).toBe('0.000000001');
    expect(formatAmount(-5_000_000n, 6)).toBe('-5');
    expect(formatAmount(7n, 0)).toBe('7');
  });

  it('round-trips', () => {
    for (const s of ['0', '1', '0.1', '123.456789']) expect(formatAmount(parseAmount(s, 6), 6)).toBe(s);
  });
});

describe('UTC time', () => {
  const start = Date.parse('2026-11-27T00:00:00Z') / 1000;

  it('day index', () => {
    expect(dayIndexAt(start - 1, start)).toBe(-1);
    expect(dayIndexAt(start, start)).toBe(0);
    expect(dayIndexAt(start + 86_399, start)).toBe(0);
    expect(dayIndexAt(start + 86_400, start)).toBe(1);
  });

  it('compressed demo days', () => {
    expect(dayIndexAt(start + 299, start, 300)).toBe(0);
    expect(dayIndexAt(start + 600, start, 300)).toBe(2);
    expect(dayWindow(start, 2, 300)).toEqual({ start: start + 600, end: start + 900 });
  });

  it('next UTC midnight and date string (IST evening is still the same UTC day)', () => {
    const istEvening = new Date('2026-11-20T23:30:00+05:30'); // 18:00 UTC
    expect(utcDateString(istEvening)).toBe('2026-11-20');
    expect(nextUtcMidnight(istEvening).toISOString()).toBe('2026-11-21T00:00:00.000Z');
  });
});
