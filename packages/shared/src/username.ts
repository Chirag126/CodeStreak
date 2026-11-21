// Username rules, identical to the database check `^[a-z0-9_]{3,20}$` (profiles.username) plus a
// reserved list. Uniqueness is enforced by the database's unique constraint.
import { z } from 'zod';

export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

/** Names that could impersonate the app or collide with routes. */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin', 'administrator', 'api', 'app', 'auth', 'codestreak', 'dashboard', 'help', 'me', 'mod',
  'moderator', 'null', 'official', 'onboarding', 'root', 'settings', 'sign_in', 'signin', 'signup',
  'staff', 'support', 'system', 'team', 'undefined',
]);

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export const usernameSchema = z
  .string()
  .transform(normalizeUsername)
  .pipe(
    z
      .string()
      .min(3, 'At least 3 characters.')
      .max(20, 'At most 20 characters.')
      .regex(USERNAME_PATTERN, 'Only lowercase letters, numbers and underscores.')
      .refine((v) => !RESERVED_USERNAMES.has(v), 'That username is reserved.'),
  );

/** Postgres unique-violation on profiles.username -> the user-facing "taken" message. */
export function usernameErrorFromDb(error: { code?: string; message?: string } | null): string | null {
  if (!error) return null;
  if (error.code === '23505') return 'That username is taken.';
  if (error.code === '23514') return 'That username is not allowed.';
  return 'Could not save your username. Please try again.';
}
