// Phase 33 - personal coding consistency insights, computed only from recorded day results and
// counted evidence (no estimates). A "day" is a challenge day; its date is the UTC date its
// window started. Weeks are ISO weeks (Monday 00:00 UTC).

export interface InsightDay {
  challenge: string;
  /** Unix seconds (UTC) the day's window started. */
  startedAt: number;
  result: 'verified' | 'failed' | 'indeterminate';
  shielded?: boolean;
}

export interface InsightEvidence {
  /** Unix seconds (UTC) of the day it counted for. */
  at: number;
  provider: 'github' | 'leetcode';
}

export interface WeekSummary {
  /** Monday of the week, YYYY-MM-DD (UTC). */
  week: string;
  verified: number;
  failed: number;
  indeterminate: number;
  /** Missed but covered by a Shield. */
  shielded: number;
  commits: number;
  solves: number;
}

export interface Insights {
  recordedDays: number;
  verified: number;
  failed: number;
  indeterminate: number;
  shielded: number;
  /** Verified share of decided days (verified + failed), 0-100, or null with no decided day. */
  successRate: number | null;
  /** Consecutive verified (or shielded) days ending at the latest recorded one. */
  currentStreak: number;
  longestStreak: number;
  /** Verified days per UTC weekday, Monday first. */
  byWeekday: number[];
  /** Last `weeks` ISO weeks, oldest first (empty weeks included). */
  weekly: WeekSummary[];
  commits: number;
  solves: number;
}

const DAY = 86_400;
const kept = (d: InsightDay) => d.result === 'verified' || Boolean(d.shielded);

/** Monday 00:00 UTC of the week containing `unixSecs`. */
export function isoWeekStart(unixSecs: number): number {
  const midnight = Math.floor(unixSecs / DAY) * DAY;
  const weekday = (new Date(midnight * 1000).getUTCDay() + 6) % 7; // Monday = 0
  return midnight - weekday * DAY;
}

const ymd = (unixSecs: number) => new Date(unixSecs * 1000).toISOString().slice(0, 10);

export function computeInsights(days: InsightDay[], evidence: InsightEvidence[], now: number, weeks = 8): Insights {
  const sorted = [...days].sort((a, b) => a.startedAt - b.startedAt || (a.challenge < b.challenge ? -1 : 1));
  let longest = 0;
  let run = 0;
  for (const d of sorted) {
    run = kept(d) ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const verified = sorted.filter((d) => d.result === 'verified').length;
  const failed = sorted.filter((d) => d.result === 'failed' && !d.shielded).length;
  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  for (const d of sorted) if (d.result === 'verified') byWeekday[(new Date(d.startedAt * 1000).getUTCDay() + 6) % 7]!++;

  const thisWeek = isoWeekStart(now);
  const weekly: WeekSummary[] = Array.from({ length: weeks }, (_, i) => ({
    week: ymd(thisWeek - (weeks - 1 - i) * 7 * DAY),
    verified: 0,
    failed: 0,
    indeterminate: 0,
    shielded: 0,
    commits: 0,
    solves: 0,
  }));
  const slot = (t: number) => weekly.find((w) => w.week === ymd(isoWeekStart(t)));
  for (const d of sorted) {
    const w = slot(d.startedAt);
    if (!w) continue;
    if (d.result === 'verified') w.verified++;
    else if (d.shielded) w.shielded++;
    else if (d.result === 'failed') w.failed++;
    else w.indeterminate++;
  }
  for (const e of evidence) {
    const w = slot(e.at);
    if (w) e.provider === 'github' ? w.commits++ : w.solves++;
  }
  return {
    recordedDays: sorted.length,
    verified,
    failed,
    indeterminate: sorted.filter((d) => d.result === 'indeterminate' && !d.shielded).length,
    shielded: sorted.filter((d) => d.shielded && d.result !== 'verified').length,
    successRate: verified + failed > 0 ? Math.round((verified * 100) / (verified + failed)) : null,
    currentStreak: run,
    longestStreak: longest,
    byWeekday,
    weekly,
    commits: evidence.filter((e) => e.provider === 'github').length,
    solves: evidence.filter((e) => e.provider === 'leetcode').length,
  };
}
