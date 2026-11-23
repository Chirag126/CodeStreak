// LeetCode public profile parsing (isomorphic, deterministic: no LLM extraction).
// Input: markdown from Firecrawl v2 /scrape of https://leetcode.com/u/<handle>/ with maxAge 0.
// Validated in Phase 2 on a real profile: "704/4115\n\nSolved" and 15 "Recent AC" links whose
// submission IDs strictly decrease from newest to oldest.

export interface RecentAccepted {
  title: string;
  ago: string;
  approxAgeSeconds: number | null;
  submissionId: string;
}

export interface LeetcodeSnapshot {
  solved: number | null;
  totalProblems: number | null;
  /** Solved per difficulty ("Easy 128/978", "Med. 426/2152", "Hard 155/993"). */
  easy?: number | null;
  medium?: number | null;
  hard?: number | null;
  recentAccepted: RecentAccepted[];
  hasRecentAcSection: boolean;
}

const UNIT_SECONDS: Record<string, number> = {
  second: 1,
  minute: 60,
  hour: 3600,
  day: 86_400,
  week: 7 * 86_400,
  month: 30 * 86_400,
  year: 365 * 86_400,
};

/** "3 days ago" -> 259200, "an hour ago" -> 3600; null when unparseable. */
export function agoToSeconds(text: string): number | null {
  const m = /^(a|an|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i.exec(text.trim());
  if (!m || !m[1] || !m[2]) return null;
  const n = /^an?$/i.test(m[1]) ? 1 : Number(m[1]);
  const unit = UNIT_SECONDS[m[2].toLowerCase()];
  return unit === undefined ? null : n * unit;
}

const AC_RE =
  /\[([^\]]*?)((?:a|an|\d+)\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)\]\((?:https:\/\/leetcode\.com)?\/submissions\/detail\/(\d+)\/?\)/g;

export function parseLeetcodeProfile(markdown: string): LeetcodeSnapshot {
  const solvedMatch = /(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*\n+\s*Solved\b/.exec(markdown);
  const solved = solvedMatch?.[1] ? Number(solvedMatch[1].replace(/,/g, '')) : null;
  const totalProblems = solvedMatch?.[2] ? Number(solvedMatch[2].replace(/,/g, '')) : null;

  const recentAccepted: RecentAccepted[] = [];
  const seen = new Set<string>();
  for (const m of markdown.matchAll(AC_RE)) {
    const [, title = '', ago = '', submissionId = ''] = m;
    if (!submissionId || seen.has(submissionId)) continue;
    seen.add(submissionId);
    recentAccepted.push({ title: title.trim(), ago, approxAgeSeconds: agoToSeconds(ago), submissionId });
  }
  const level = (label: string) => {
    const m = new RegExp(`\\b${label}\\s*\\n+\\s*(\\d[\\d,]*)\\s*\\/\\s*\\d`).exec(markdown);
    return m?.[1] ? Number(m[1].replace(/,/g, '')) : null;
  };
  return {
    solved,
    totalProblems,
    easy: level('Easy'),
    medium: level('Med\\.?(?:ium)?'),
    hard: level('Hard'),
    recentAccepted,
    hasRecentAcSection: /\bRecent AC\b/.test(markdown),
  };
}

/** True when the exact verification code appears as a standalone token (used for account binding). */
export function containsVerificationCode(markdown: string, code: string): boolean {
  if (!code) return false;
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9-])${escaped}([^A-Za-z0-9-]|$)`).test(markdown);
}

/**
 * New accepted submissions between two snapshots: IDs absent from `before` and above its newest ID.
 * A qualifying LeetCode day needs at least one new accepted submission AND solvedDelta > 0
 * (re-solving an old problem creates a submission but no solved-count increase).
 */
export function diffLeetcodeSnapshots(before: LeetcodeSnapshot, after: LeetcodeSnapshot): { newAccepted: RecentAccepted[]; solvedDelta: number | null; qualifies: boolean } {
  const beforeIds = new Set(before.recentAccepted.map((r) => r.submissionId));
  const maxBefore = before.recentAccepted.reduce((max, r) => (BigInt(r.submissionId) > max ? BigInt(r.submissionId) : max), 0n);
  const newAccepted = after.recentAccepted.filter((r) => !beforeIds.has(r.submissionId) && BigInt(r.submissionId) > maxBefore);
  const solvedDelta = before.solved !== null && after.solved !== null ? after.solved - before.solved : null;
  return { newAccepted, solvedDelta, qualifies: newAccepted.length > 0 && solvedDelta !== null && solvedDelta > 0 };
}

// ---------------------------------------------------------------- binding (Phase 26)

export type BindingPageCheck = { ok: true } | { ok: false; reason: 'unreadable' | 'no_profile' | 'code_missing' };

/**
 * Does a freshly scraped page prove that `handle` placed `code` on their profile?
 *  - the page loaded (HTTP 200) and is that user's profile: LeetCode titles it
 *    "<handle> - LeetCode Profile" (checked live on a real profile, Phase 26);
 *  - the exact code appears as a standalone token (not inside a longer word or link).
 * Only the profile owner can put text on their own profile page.
 */
export function checkBindingPage(input: { pageStatus: number | null | undefined; title: string | null | undefined; markdown: string; handle: string; code: string }): BindingPageCheck {
  if (input.pageStatus === 404) return { ok: false, reason: 'no_profile' };
  if (input.pageStatus !== 200 || !input.markdown.trim()) return { ok: false, reason: 'unreadable' };
  if ((input.title ?? '').trim().toLowerCase() !== `${input.handle.toLowerCase()} - leetcode profile`) return { ok: false, reason: 'no_profile' };
  return containsVerificationCode(input.markdown, input.code) ? { ok: true } : { ok: false, reason: 'code_missing' };
}
