// All challenge time math is in UTC seconds. A challenge has a start time and a day length
// (86_400 for real challenges, shorter for clearly labeled demo challenges).
import { SECONDS_PER_DAY } from './constants.js';

/** Index of the challenge day containing `nowSec`; -1 before the start. */
export function dayIndexAt(nowSec: number, startSec: number, dayLengthSec = SECONDS_PER_DAY): number {
  if (dayLengthSec <= 0) throw new Error('dayLengthSec must be positive');
  if (nowSec < startSec) return -1;
  return Math.floor((nowSec - startSec) / dayLengthSec);
}

/** [start, end) of a challenge day in UTC seconds. */
export function dayWindow(startSec: number, dayIndex: number, dayLengthSec = SECONDS_PER_DAY): { start: number; end: number } {
  if (dayIndex < 0) throw new Error('dayIndex must be >= 0');
  const start = startSec + dayIndex * dayLengthSec;
  return { start, end: start + dayLengthSec };
}

/** The next 00:00:00 UTC strictly after `date`. */
export function nextUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));
}

/** "YYYY-MM-DD" in UTC. */
export function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
