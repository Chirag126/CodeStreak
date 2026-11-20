import { describe, expect, it } from 'vitest';
import { agoToSeconds, containsVerificationCode, diffLeetcodeSnapshots, parseLeetcodeProfile } from './leetcode.js';

// Synthetic page with the same structure Firecrawl returned for a real profile in Phase 2.
const page = (solved: number, entries: [string, string, string][], summary = 'Coding every day') =>
  [
    'demo_user',
    '',
    summary,
    '',
    `${solved}/4115`,
    '',
    'Solved',
    '',
    'Recent AC',
    '',
    entries.map(([t, ago, id]) => `[${t}${ago}](https://leetcode.com/submissions/detail/${id}/)`).join(' '),
  ].join('\n');

describe('leetcode parsing', () => {
  it('relative times', () => {
    expect(agoToSeconds('3 days ago')).toBe(259_200);
    expect(agoToSeconds('an hour ago')).toBe(3600);
    expect(agoToSeconds('just now')).toBeNull();
  });

  it('solved count and glued title/time entries', () => {
    const p = parseLeetcodeProfile(page(42, [['Count Valid Substrings II', '13 days ago', '2191420316'], ['Two Sum', 'a month ago', '2181076640']]));
    expect(p.solved).toBe(42);
    expect(p.totalProblems).toBe(4115);
    expect(p.recentAccepted.map((r) => [r.title, r.ago])).toEqual([
      ['Count Valid Substrings II', '13 days ago'],
      ['Two Sum', 'a month ago'],
    ]);
  });

  it('private or missing profile gives nulls', () => {
    const p = parseLeetcodeProfile('This profile is private');
    expect(p.solved).toBeNull();
    expect(p.recentAccepted).toEqual([]);
    expect(p.hasRecentAcSection).toBe(false);
  });

  it('verification code is a whole token', () => {
    expect(containsVerificationCode(page(1, [], 'my code CS-VERIFY-TEST01'), 'CS-VERIFY-TEST01')).toBe(true);
    expect(containsVerificationCode(page(1, [], 'CS-VERIFY-TEST012'), 'CS-VERIFY-TEST01')).toBe(false);
  });

  it('a new solve qualifies; re-solving an old problem does not', () => {
    const anchor = parseLeetcodeProfile(page(41, [['Old', '2 days ago', '2190000000']]));
    const solvedNew = parseLeetcodeProfile(page(42, [['New', '3 minutes ago', '2200000005'], ['Old', '2 days ago', '2190000000']]));
    const resolved = parseLeetcodeProfile(page(41, [['Old', '1 minute ago', '2200000009']]));
    expect(diffLeetcodeSnapshots(anchor, solvedNew)).toMatchObject({ solvedDelta: 1, qualifies: true });
    expect(diffLeetcodeSnapshots(anchor, resolved)).toMatchObject({ solvedDelta: 0, qualifies: false });
  });

  it('missing data never qualifies', () => {
    const p = parseLeetcodeProfile('private');
    expect(diffLeetcodeSnapshots(p, p).qualifies).toBe(false);
  });
});
