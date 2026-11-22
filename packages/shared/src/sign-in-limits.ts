// Sign-in attempt limits (pure): 3 tries per email, then a visible cooldown.

export const SIGN_IN_LIMITS = {
  /** Emails we will request for one address before a cooldown. */
  maxSends: 3,
  /** Wrong codes accepted for one address before a cooldown. */
  maxBadCodes: 3,
  /** Attempts older than this no longer count. */
  windowSecs: 15 * 60,
  /** Supabase's built-in email sender is capped per project per hour; our best guess at a wait. */
  providerCooldownSecs: 15 * 60,
} as const;

/**
 * Given the times (ms) of recent attempts of one kind for an email, returns null if another is
 * allowed now, or when the next one will be (the oldest counted attempt leaving the window).
 */
export function nextAttemptAt(attempts: number[], now: number, max: number, windowSecs: number = SIGN_IN_LIMITS.windowSecs): number | null {
  const windowMs = windowSecs * 1000;
  const recent = attempts.filter((t) => t > now - windowMs).sort((a, b) => a - b);
  if (recent.length < max) return null;
  return recent[recent.length - max]! + windowMs;
}

/**
 * Seconds to wait from Supabase's own errors: the per-address resend interval ("you can only
 * request this after 37 seconds") or the project's email allowance (`over_email_send_rate_limit`).
 */
export function providerWaitSecs(error: { message: string; code?: string | undefined }): number | null {
  const m = /after (\d+) seconds?/i.exec(error.message);
  if (m) return Number(m[1]);
  if (error.code === 'over_email_send_rate_limit' || /email rate limit/i.test(error.message)) return SIGN_IN_LIMITS.providerCooldownSecs;
  if (error.code === 'over_request_rate_limit' || /rate limit|too many/i.test(error.message)) return 60;
  return null;
}

/** "4:05" style countdown label. */
export function formatWait(secs: number): string {
  const s = Math.max(0, Math.ceil(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
