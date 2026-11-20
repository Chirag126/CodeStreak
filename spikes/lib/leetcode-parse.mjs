// Deterministic parser for the markdown Firecrawl returns for a public LeetCode
// profile page (https://leetcode.com/u/<handle>/). No LLM extraction: the same
// input always gives the same output, which matters for verification receipts.
//
// Observed page structure (Nov 2026):
//   "704/4115\n\nSolved"                                   -> solved / total problems
//   "[Some Problem Title3 days ago](https://leetcode.com/submissions/detail/2198067669/)"
//                                                          -> one "Recent AC" entry
// The title and the relative time are glued together in the link text.

const UNIT_SECONDS = {
  second: 1,
  minute: 60,
  hour: 3600,
  day: 86400,
  week: 7 * 86400,
  month: 30 * 86400,
  year: 365 * 86400,
};

/** "3 days ago" -> 259200, "an hour ago" -> 3600. Returns null when unparseable. */
export function agoToSeconds(text) {
  const m = /^(a|an|\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago$/i.exec(String(text).trim());
  if (!m) return null;
  const n = m[1].toLowerCase() === 'a' || m[1].toLowerCase() === 'an' ? 1 : Number(m[1]);
  return n * UNIT_SECONDS[m[2].toLowerCase()];
}

const AC_RE =
  /\[([^\]]*?)((?:a|an|\d+)\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)\]\((?:https:\/\/leetcode\.com)?\/submissions\/detail\/(\d+)\/?\)/g;

/**
 * Parses a profile page.
 * @returns {{
 *   solved: number|null, totalProblems: number|null,
 *   recentAccepted: { title: string, ago: string, approxAgeSeconds: number|null, submissionId: string }[],
 *   hasRecentAcSection: boolean
 * }}
 */
export function parseLeetCodeProfile(markdown) {
  const md = String(markdown ?? '');

  const solvedMatch = /(\d[\d,]*)\s*\/\s*(\d[\d,]*)\s*\n+\s*Solved\b/.exec(md);
  const solved = solvedMatch ? Number(solvedMatch[1].replace(/,/g, '')) : null;
  const totalProblems = solvedMatch ? Number(solvedMatch[2].replace(/,/g, '')) : null;

  const recentAccepted = [];
  const seen = new Set();
  AC_RE.lastIndex = 0;
  let m;
  while ((m = AC_RE.exec(md)) !== null) {
    const submissionId = m[3];
    if (seen.has(submissionId)) continue;
    seen.add(submissionId);
    recentAccepted.push({
      title: m[1].trim(),
      ago: m[2],
      approxAgeSeconds: agoToSeconds(m[2]),
      submissionId,
    });
  }

  return { solved, totalProblems, recentAccepted, hasRecentAcSection: /\bRecent AC\b/.test(md) };
}

/** True when the exact verification code appears in the page as a standalone token. */
export function containsVerificationCode(markdown, code) {
  if (!code) return false;
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9-])${escaped}([^A-Za-z0-9-]|$)`).test(String(markdown ?? ''));
}

/**
 * Compares two snapshots of the same profile.
 * New accepted submissions are those whose submission IDs were not in the earlier snapshot
 * and are numerically larger than its newest ID (IDs increase over time).
 */
export function diffSnapshots(before, after) {
  const beforeIds = new Set(before.recentAccepted.map((r) => r.submissionId));
  const maxBefore = before.recentAccepted.reduce((max, r) => (BigInt(r.submissionId) > max ? BigInt(r.submissionId) : max), 0n);
  const newAccepted = after.recentAccepted.filter((r) => !beforeIds.has(r.submissionId) && BigInt(r.submissionId) > maxBefore);
  const solvedDelta = before.solved !== null && after.solved !== null ? after.solved - before.solved : null;
  return { newAccepted, solvedDelta };
}
