import { describe, expect, it } from 'vitest';
import { formatWait, nextAttemptAt, providerWaitSecs, SIGN_IN_LIMITS } from './sign-in-limits.js';

const NOW = 1_800_000_000_000;
const min = (m: number) => NOW - m * 60_000;

describe('sign-in attempt limit', () => {
  it('allows the first three tries', () => {
    expect(nextAttemptAt([], NOW, 3)).toBeNull();
    expect(nextAttemptAt([min(5), min(2)], NOW, 3)).toBeNull();
  });
  it('blocks the fourth try until the oldest of the three leaves the 15-minute window', () => {
    expect(nextAttemptAt([min(10), min(5), min(1)], NOW, 3)).toBe(min(10) + SIGN_IN_LIMITS.windowSecs * 1000);
  });
  it('forgets tries older than the window', () => {
    expect(nextAttemptAt([min(40), min(20), min(1)], NOW, 3)).toBeNull();
  });
});

describe('provider waits', () => {
  it('reads the per-address resend interval', () => {
    expect(providerWaitSecs({ message: 'For security purposes, you can only request this after 37 seconds.' })).toBe(37);
  });
  it('maps the project email allowance to a cooldown', () => {
    expect(providerWaitSecs({ message: 'email rate limit exceeded', code: 'over_email_send_rate_limit' })).toBe(SIGN_IN_LIMITS.providerCooldownSecs);
  });
  it('ignores other errors', () => {
    expect(providerWaitSecs({ message: 'Invalid email' })).toBeNull();
  });
  it('formats the countdown', () => {
    expect(formatWait(245)).toBe('4:05');
    expect(formatWait(0.2)).toBe('0:01');
    expect(formatWait(-3)).toBe('0:00');
  });
});
