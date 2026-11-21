// Pure mirror of the program's clock-derived lifecycle (programs/codestreak/src/state/challenge.rs).
// Keep in sync with `Challenge::phase` and `Challenge::day_index`; covered by lifecycle.test.ts.

export type PoolStateName = 'open' | 'cancelled' | 'settled';

export type ChallengePhase =
  | 'joining'
  | 'starting'
  | 'active'
  | 'verifying'
  | 'disputeWindow'
  | 'awaitingSettlement'
  | 'settled'
  | 'cancelled';

/** The timing fields of a Challenge account, as plain numbers (unix seconds). */
export interface ChallengeTimes {
  state: PoolStateName;
  startTs: number;
  dayLengthSecs: number;
  numDays: number;
  joinDeadlineTs: number;
  verifyWindowSecs: number;
  disputeWindowSecs: number;
}

export function endTs(c: ChallengeTimes): number {
  return c.startTs + c.numDays * c.dayLengthSecs;
}

export function verifyEndTs(c: ChallengeTimes): number {
  return endTs(c) + c.verifyWindowSecs;
}

export function disputeEndTs(c: ChallengeTimes): number {
  return verifyEndTs(c) + c.disputeWindowSecs;
}

export function challengePhase(c: ChallengeTimes, now: number): ChallengePhase {
  if (c.state === 'cancelled') return 'cancelled';
  if (c.state === 'settled') return 'settled';
  if (now < c.joinDeadlineTs) return 'joining';
  if (now < c.startTs) return 'starting';
  if (now < endTs(c)) return 'active';
  if (now < verifyEndTs(c)) return 'verifying';
  if (now < disputeEndTs(c)) return 'disputeWindow';
  return 'awaitingSettlement';
}

/** Challenge day (0-based) containing `now`, or null outside the active period. */
export function dayIndex(c: ChallengeTimes, now: number): number | null {
  if (now < c.startTs || now >= endTs(c)) return null;
  return Math.floor((now - c.startTs) / c.dayLengthSecs);
}

/** Anchor decodes Rust enums as `{ variantName: {} }`; returns the variant name. */
export function enumVariant<T extends string>(value: Partial<Record<T, unknown>>): T {
  const keys = Object.keys(value);
  if (keys.length !== 1) throw new Error(`not an enum value: ${JSON.stringify(value)}`);
  return keys[0] as T;
}
