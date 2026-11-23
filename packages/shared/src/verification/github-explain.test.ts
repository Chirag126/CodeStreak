import { describe, expect, it } from 'vitest';
import { explainGithubDay, SKIP_REASON_TEXT } from './github-explain.js';
import type { GithubDayResult } from './github.js';

const day = (over: Partial<GithubDayResult> = {}): GithubDayResult => ({
  meaningfulLines: 2,
  meetsThreshold: false,
  breakdown: { code: 2, docs: 0, docsCredited: 0, generated: 0, generatedCredited: 0 },
  counted: [{ sha: 'c6f65870', repo: 'Chirag126/trust-dependency-mapper', meaningfulLines: 2, diffHash: 'x' }],
  skipped: [],
  anomalies: [],
  missingPatches: 0,
  ...over,
});
const data = { pushes: 6, complete: true, repos: [{ fullName: 'Chirag126/CodeStreak', status: 'read' }] };

describe('day explanations', () => {
  it('real 23 Nov day: names other-account commits correctly, with grammar', () => {
    const skipped = [
      ...Array.from({ length: 14 }, (_, i) => ({ sha: `a${i}`, repo: 'Chirag126/CodeStreak', reason: 'author-mismatch' as const })),
      ...Array.from({ length: 9 }, (_, i) => ({ sha: `m${i}`, repo: 'Chirag126/CodeStreak', reason: 'merge-commit' as const })),
      { sha: '0ecb47e2', repo: 'Chirag126/trust-dependency-mapper', reason: 'no-eligible-changes' as const },
    ];
    expect(explainGithubDay(data, day({ skipped }), 15, { selectedRepos: false })).toEqual([
      '14 commits were written by another GitHub account, so they don’t count for you.',
      '9 commits are merges; merged work counts on the day it is pushed.',
      '1 commit changes no countable code.',
      '13 more meaningful lines are needed to reach 15.',
    ]);
  });

  it('says exactly why nothing was found', () => {
    const none = day({ counted: [], meaningfulLines: 0 });
    expect(explainGithubDay({ pushes: 0, complete: true, repos: [] }, none, 15, { selectedRepos: false })[0]).toMatch(/None of your public repositories was pushed/);
    expect(explainGithubDay({ pushes: 0, complete: true, repos: [] }, none, 15, { selectedRepos: true })[0]).toMatch(/no pushes to this challenge's repositories/);
    expect(explainGithubDay({ pushes: 0, complete: true, repos: [{ fullName: 'a/b', status: 'no-pushes' }] }, none, 15, { selectedRepos: false })[0]).toMatch(/not by you: a\/b/);
  });

  it('goal reached comes first; incomplete data is explained, never "needs more lines"', () => {
    expect(explainGithubDay(data, day({ meaningfulLines: 18, meetsThreshold: true }), 15, { selectedRepos: false })[0]).toBe('Goal reached: 18 of 15 meaningful lines.');
    const partial = explainGithubDay({ ...data, complete: false }, day(), 15, { selectedRepos: false });
    expect(partial.some((h) => /never costs a stake/.test(h))).toBe(true);
    expect(partial.some((h) => /needed to reach/.test(h))).toBe(false);
  });

  it('has a plain sentence for every skip reason', () => {
    for (const text of Object.values(SKIP_REASON_TEXT)) expect(text.length).toBeGreaterThan(10);
  });
});
