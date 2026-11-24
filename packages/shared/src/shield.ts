// Phase 32 - Shield eligibility, exactly as the program decides it (programs/codestreak/src/rules.rs
// check_shield): a Shield protects one day; it can be bought once the day has started and until
// `shieldGraceSecs` after the day ends (so a missed day can be rescued), at most
// `maxShields` times per player. Used by the server (before preparing a transaction) and the
// browser (countdown and button state); the program checks again on-chain.

export interface ShieldChallenge {
  state: 'open' | 'cancelled' | 'settled';
  startTs: number;
  dayLengthSecs: number;
  numDays: number;
  shieldPrice: bigint;
  maxShields: number;
  shieldGraceSecs: number;
}

export interface ShieldParticipant {
  finalized: boolean;
  shieldsUsed: number;
  /** Bitmasks, bit d = day d. */
  shieldedDays: bigint;
  verifiedDays: bigint;
}

export type ShieldBlock =
  | 'disabled'
  | 'closed' // the challenge is no longer open
  | 'finalized'
  | 'invalid_day'
  | 'not_started'
  | 'grace_over'
  | 'already_shielded'
  | 'already_verified'
  | 'limit_reached';

export const SHIELD_BLOCK_TEXT: Record<ShieldBlock, string> = {
  disabled: 'Shields are turned off for this challenge.',
  closed: 'This challenge is over, so its days can no longer be protected.',
  finalized: 'Your result is final, so no more Shields can be bought.',
  invalid_day: 'This challenge has no such day.',
  not_started: "This day hasn't started yet. Shields can be bought once it starts.",
  grace_over: 'Too late to protect this day: the Shield grace period is over.',
  already_shielded: 'This day is already protected.',
  already_verified: 'This day is already verified, so it needs no Shield.',
  limit_reached: 'You have used all your Shields for this challenge.',
};

export const shieldsEnabled = (c: Pick<ShieldChallenge, 'maxShields' | 'shieldPrice'>) => c.maxShields > 0 && c.shieldPrice > 0n;

/** When a Shield can be bought for `day`: [day start, day end + grace). */
export function shieldWindow(c: ShieldChallenge, day: number): { opensAt: number; dayEndsAt: number; closesAt: number } {
  const opensAt = c.startTs + day * c.dayLengthSecs;
  const dayEndsAt = opensAt + c.dayLengthSecs;
  return { opensAt, dayEndsAt, closesAt: dayEndsAt + c.shieldGraceSecs };
}

/** Why `day` can't be shielded at `now` (same order of checks as the program), or null if it can. */
export function shieldBlock(c: ShieldChallenge, p: ShieldParticipant, day: number, now: number): ShieldBlock | null {
  if (!shieldsEnabled(c)) return 'disabled';
  if (c.state !== 'open') return 'closed';
  if (p.finalized) return 'finalized';
  if (!Number.isInteger(day) || day < 0 || day >= c.numDays) return 'invalid_day';
  const w = shieldWindow(c, day);
  if (now < w.opensAt) return 'not_started';
  if (now >= w.closesAt) return 'grace_over';
  const bit = 1n << BigInt(day);
  if (p.shieldedDays & bit) return 'already_shielded';
  if (p.verifiedDays & bit) return 'already_verified';
  if (p.shieldsUsed >= c.maxShields) return 'limit_reached';
  return null;
}

export interface ShieldDayView {
  day: number;
  /** null = can be shielded now. */
  block: ShieldBlock | null;
  opensAt: number;
  dayEndsAt: number;
  closesAt: number;
  /** In the grace period: the day is over but can still be rescued. */
  inGrace: boolean;
}

/** The days worth showing now: the current day and any finished day still inside its grace. */
export function shieldableDays(c: ShieldChallenge, p: ShieldParticipant, now: number): ShieldDayView[] {
  if (!shieldsEnabled(c)) return [];
  const out: ShieldDayView[] = [];
  for (let d = 0; d < c.numDays; d++) {
    const w = shieldWindow(c, d);
    if (now < w.opensAt || now >= w.closesAt) continue;
    out.push({ day: d, block: shieldBlock(c, p, d, now), ...w, inGrace: now >= w.dayEndsAt });
  }
  return out;
}
