import { describe, expect, it } from 'vitest';
import { currentDeadline, utcClock, warningLeadSecs } from './deadline.js';

describe('UTC deadline warnings', () => {
  it('warns 3 hours ahead on real days, a quarter-day ahead on demo days', () => {
    expect(warningLeadSecs(86_400)).toBe(10_800);
    expect(warningLeadSecs(43_200)).toBe(10_800);
    expect(warningLeadSecs(600)).toBe(150);
    expect(warningLeadSecs(120)).toBe(60);
  });

  it('computes the day, its UTC end and the warning window', () => {
    // A daily challenge starting 2026-11-24 00:00 UTC.
    const t = { startTs: Date.UTC(2026, 10, 24) / 1000, dayLengthSecs: 86_400, numDays: 7 };
    const at2059 = Date.UTC(2026, 10, 25, 20, 59) / 1000;
    const at2100 = Date.UTC(2026, 10, 25, 21, 0) / 1000;
    expect(currentDeadline(t, at2059)).toMatchObject({ day: 1, due: false });
    const d = currentDeadline(t, at2100)!;
    expect(d).toMatchObject({ day: 1, due: true, secsLeft: 3 * 3600 });
    expect(utcClock(d.endsAt)).toBe('00:00 UTC');
    expect(new Date(d.endsAt * 1000).toISOString()).toBe('2026-11-26T00:00:00.000Z');
  });

  it('is null before the start and after the last day; the end itself is not "due"', () => {
    const t = { startTs: 1000, dayLengthSecs: 600, numDays: 3 };
    expect(currentDeadline(t, 999)).toBeNull();
    expect(currentDeadline(t, 2800)).toBeNull();
    expect(currentDeadline(t, 1599)).toMatchObject({ day: 0, due: true, secsLeft: 1 });
    expect(currentDeadline(t, 1600)).toMatchObject({ day: 1, due: false });
  });
});
