// When each challenge day becomes due for recording. Mirrors private.record_delay_secs (SQL).
import { endTs, verifyEndTs, type ChallengeTimes } from '@codestreak/shared/program';

/** A quarter of a day (1 to 45 minutes), never so late that the verification window closes first. */
export function recordDelaySecs(dayLengthSecs: number, secsUntilVerifyEnd: number): number {
  return Math.min(Math.min(2700, Math.max(60, Math.floor(dayLengthSecs / 4))), Math.max(0, secsUntilVerifyEnd - 120));
}

export function dayWindow(t: ChallengeTimes, day: number): { startSec: number; endSec: number } {
  const startSec = t.startTs + day * t.dayLengthSecs;
  return { startSec, endSec: startSec + t.dayLengthSecs };
}

/** Days whose results are due now (ended + delay passed) and can still be recorded (before verify end). */
export function dueDays(t: ChallengeTimes, now: number): number[] {
  if (now >= verifyEndTs(t) || now < t.startTs) return [];
  const out: number[] = [];
  for (let d = 0; d < t.numDays; d++) {
    const end = dayWindow(t, d).endSec;
    if (end > endTs(t)) break;
    if (end + recordDelaySecs(t.dayLengthSecs, verifyEndTs(t) - end) <= now) out.push(d);
  }
  return out;
}
