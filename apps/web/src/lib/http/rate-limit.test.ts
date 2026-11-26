import { beforeEach, describe, expect, it } from 'vitest';
import { clientAddress, resetRateLimits, takeToken } from './rate-limit';

const rule = { name: 't', limit: 3, windowMs: 10_000 };

describe('takeToken', () => {
  beforeEach(resetRateLimits);

  it('allows up to the limit, then asks to wait until the window ends', () => {
    expect([0, 1, 2].map(() => takeToken('a', rule, 1_000))).toEqual([0, 0, 0]);
    expect(takeToken('a', rule, 1_000)).toBe(10);
    expect(takeToken('a', rule, 9_500)).toBe(2);
  });

  it('counts each address and rule separately', () => {
    for (let i = 0; i < 3; i++) takeToken('a', rule, 0);
    expect(takeToken('a', rule, 0)).toBeGreaterThan(0);
    expect(takeToken('b', rule, 0)).toBe(0);
    expect(takeToken('a', { ...rule, name: 'other' }, 0)).toBe(0);
  });

  it('starts a fresh window after it expires', () => {
    for (let i = 0; i < 5; i++) takeToken('a', rule, 0);
    expect(takeToken('a', rule, 10_000)).toBe(0);
  });
});

describe('clientAddress', () => {
  it('takes the first forwarded address and caps its length', () => {
    expect(clientAddress(new Request('https://x', { headers: { 'x-forwarded-for': ' 1.2.3.4 , 10.0.0.1' } }))).toBe('1.2.3.4');
    expect(clientAddress(new Request('https://x', { headers: { 'x-real-ip': '5.6.7.8' } }))).toBe('5.6.7.8');
    expect(clientAddress(new Request('https://x'))).toBe('unknown');
    expect(clientAddress(new Request('https://x', { headers: { 'x-forwarded-for': 'a'.repeat(500) } }))).toHaveLength(64);
  });
});
