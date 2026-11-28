// Phase 33 - UTC deadline warnings (mirrors private.warning_lead_secs / send_deadline_warnings).
// Every time here is unix seconds (UTC); a day ends at start + (day + 1) × length.

/** 3 hours before the end for real (12 h+) days; a quarter of the day (≥ 1 min) for demo days. */
export function warningLeadSecs(dayLengthSecs: number): number {
  return dayLengthSecs >= 43_200 ? 10_800 : Math.max(60, Math.floor(dayLengthSecs / 4));
}

/** Phase 41.2 "last call": 30 minutes before the end for real days, a twelfth of the day (≥ 1 min) on demo days. */
export function finalLeadSecs(dayLengthSecs: number): number {
  return dayLengthSecs >= 43_200 ? 1_800 : Math.max(60, Math.floor(dayLengthSecs / 12));
}

export interface DeadlineInfo {
  day: number;
  endsAt: number;
  warnAt: number;
  /** Inside the warning window (warnAt ≤ now < endsAt). */
  due: boolean;
  secsLeft: number;
}

/** The running day's deadline at `now`, or null before the start / after the last day. */
export function currentDeadline(t: { startTs: number; dayLengthSecs: number; numDays: number }, now: number): DeadlineInfo | null {
  if (now < t.startTs) return null;
  const day = Math.floor((now - t.startTs) / t.dayLengthSecs);
  if (day >= t.numDays) return null;
  const endsAt = t.startTs + (day + 1) * t.dayLengthSecs;
  const warnAt = endsAt - warningLeadSecs(t.dayLengthSecs);
  return { day, endsAt, warnAt, due: now >= warnAt && now < endsAt, secsLeft: endsAt - now };
}

/** "21:30 UTC" for a unix time. */
export function utcClock(unixSecs: number): string {
  return `${new Date(unixSecs * 1000).toISOString().slice(11, 16)} UTC`;
}
