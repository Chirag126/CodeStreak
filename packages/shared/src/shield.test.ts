import { describe, expect, it } from 'vitest';
import { formatCountdown, shieldableDays, shieldBlock, shieldWindow, type ShieldChallenge, type ShieldParticipant } from './shield.js';

// The program's own fixture (rules.rs shield_rules): start 1000, 100 s days, 3 days, 30 s grace, max 2.
const c: ShieldChallenge = { state: 'open', startTs: 1000, dayLengthSecs: 100, numDays: 3, shieldPrice: 5n, maxShields: 2, shieldGraceSecs: 30 };
const p: ShieldParticipant = { finalized: false, shieldsUsed: 0, shieldedDays: 0n, verifiedDays: 0n };

describe('shieldBlock mirrors rules.rs check_shield', () => {
  it('opens when the day starts and closes when its grace ends', () => {
    expect(shieldBlock(c, p, 1, 1_099)).toBe('not_started');
    expect(shieldBlock(c, p, 1, 1_100)).toBeNull();
    expect(shieldBlock(c, p, 1, 1_229)).toBeNull(); // inside the grace: a missed day can be rescued
    expect(shieldBlock(c, p, 1, 1_230)).toBe('grace_over'); // expired grace
    expect(shieldWindow(c, 1)).toEqual({ opensAt: 1_100, dayEndsAt: 1_200, closesAt: 1_230 });
  });
  it('refuses days outside the challenge, and over the limit', () => {
    expect(shieldBlock(c, p, 3, 1_250)).toBe('invalid_day');
    expect(shieldBlock(c, { ...p, shieldsUsed: 2 }, 1, 1_150)).toBe('limit_reached');
  });
  it('refuses a day already shielded or verified, a final result, a closed or shield-less challenge', () => {
    expect(shieldBlock(c, { ...p, shieldedDays: 0b10n }, 1, 1_150)).toBe('already_shielded');
    expect(shieldBlock(c, { ...p, verifiedDays: 0b10n }, 1, 1_150)).toBe('already_verified');
    expect(shieldBlock(c, { ...p, finalized: true }, 1, 1_150)).toBe('finalized');
    expect(shieldBlock({ ...c, state: 'settled' }, p, 1, 1_150)).toBe('closed');
    expect(shieldBlock({ ...c, maxShields: 0 }, p, 1, 1_150)).toBe('disabled');
    expect(shieldBlock({ ...c, shieldPrice: 0n }, p, 1, 1_150)).toBe('disabled');
  });
});

describe('shieldableDays', () => {
  it('shows the current day and a finished day still in its grace', () => {
    const days = shieldableDays(c, p, 1_210); // day 1 ended 10 s ago, day 2 running
    expect(days.map((d) => [d.day, d.inGrace, d.block])).toEqual([
      [1, true, null],
      [2, false, null],
    ]);
    expect(shieldableDays(c, p, 1_235).map((d) => d.day)).toEqual([2]); // day 1's grace is over
  });
  it('keeps over-limit days visible with their reason', () => {
    expect(shieldableDays(c, { ...p, shieldsUsed: 2 }, 1_150)).toMatchObject([{ day: 1, block: 'limit_reached' }]);
  });
});

it('formats countdowns compactly', () => {
  expect(formatCountdown(245)).toBe('4m 05s');
  expect(formatCountdown(3_720)).toBe('1h 02m');
  expect(formatCountdown(183_600)).toBe('2d 3h');
  expect(formatCountdown(-5)).toBe('0m 00s');
});
