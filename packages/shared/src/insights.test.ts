import { describe, expect, it } from 'vitest';
import { computeInsights, isoWeekStart, type InsightDay } from './insights.js';

const t = (iso: string) => Date.parse(iso) / 1000;
const day = (iso: string, result: InsightDay['result'], shielded = false): InsightDay => ({ challenge: 'c', startedAt: t(iso), result, shielded });

describe('coding insights', () => {
  it('uses ISO weeks (Monday 00:00 UTC)', () => {
    expect(new Date(isoWeekStart(t('2026-11-26T15:00:00Z')) * 1000).toISOString()).toBe('2026-11-23T00:00:00.000Z'); // Thu -> Mon
    expect(new Date(isoWeekStart(t('2026-11-23T00:00:00Z')) * 1000).toISOString()).toBe('2026-11-23T00:00:00.000Z');
    expect(new Date(isoWeekStart(t('2026-11-22T23:59:59Z')) * 1000).toISOString()).toBe('2026-11-16T00:00:00.000Z'); // Sunday
  });

  it('counts only recorded days, streaks, success rate and weekly summaries', () => {
    const days = [
      day('2026-11-16T00:00:00Z', 'verified'),
      day('2026-11-17T00:00:00Z', 'failed'),
      day('2026-11-18T00:00:00Z', 'verified'),
      day('2026-11-19T00:00:00Z', 'failed', true), // rescued by a Shield
      day('2026-11-20T00:00:00Z', 'verified'),
      day('2026-11-23T00:00:00Z', 'indeterminate'),
      day('2026-11-24T00:00:00Z', 'verified'),
    ];
    const evidence = [
      { at: t('2026-11-16T00:00:00Z'), provider: 'github' as const },
      { at: t('2026-11-24T00:00:00Z'), provider: 'leetcode' as const },
      { at: t('2026-01-01T00:00:00Z'), provider: 'github' as const }, // outside the 8-week window: still in totals
    ];
    const i = computeInsights(days, evidence, t('2026-11-24T12:00:00Z'));
    expect(i).toMatchObject({ recordedDays: 7, verified: 4, failed: 1, shielded: 1, indeterminate: 1, successRate: 80, commits: 2, solves: 1 });
    expect(i.longestStreak).toBe(3); // 18, 19 (shielded), 20
    expect(i.currentStreak).toBe(1); // the undecided day on the 23rd breaks it
    expect(i.byWeekday).toEqual([1, 1, 1, 0, 1, 0, 0]); // Mon 16, Wed 18, Fri 20, Tue 24
    expect(i.weekly).toHaveLength(8);
    expect(i.weekly.at(-2)).toEqual({ week: '2026-11-16', verified: 3, failed: 1, indeterminate: 0, shielded: 1, commits: 1, solves: 0 });
    expect(i.weekly.at(-1)).toEqual({ week: '2026-11-23', verified: 1, failed: 0, indeterminate: 1, shielded: 0, commits: 0, solves: 1 });
  });

  it('has no rate without decided days', () => {
    expect(computeInsights([], [], 0)).toMatchObject({ recordedDays: 0, successRate: null, currentStreak: 0 });
  });
});
