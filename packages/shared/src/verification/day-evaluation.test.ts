import { describe, expect, it } from 'vitest';
import { buildReceipt, type ReceiptInput } from '../rules-engine.js';
import { githubEvaluation, LEETCODE_FINAL_GRACE_SECS, leetcodeEvaluation } from './day-evaluation.js';
import type { GithubDayResult } from './github.js';
import { parseLeetcodeProfile } from './leetcode.js';
import { DEFAULT_LEETCODE_RULES, type LeetcodeSnapshotRecord } from './leetcode-day.js';

type Ac = [title: string, ago: string, id: string];
function page(o: { solved: number | null; recent: Ac[]; history?: boolean }) {
  return [
    'alice_99',
    o.solved === null ? '' : `${o.solved}/4123`,
    '',
    'Solved',
    '',
    'Easy',
    '',
    '60/978',
    '',
    'Med.',
    '',
    '30/2152',
    '',
    'Hard',
    '',
    '10/993',
    '',
    ...(o.history === false ? [] : ['Recent AC', '', o.recent.map(([t, ago, id]) => `[${t}${ago}](https://leetcode.com/submissions/detail/${id}/)`).join(' ')]),
  ].join('\n');
}
const snap = (at: string, o: Parameters<typeof page>[0]): LeetcodeSnapshotRecord => ({ observedAt: at, readable: true, snapshot: parseLeetcodeProfile(page(o)) });
const DAY = { startSec: Date.parse('2026-11-24T00:00:00Z') / 1000, endSec: Date.parse('2026-11-25T00:00:00Z') / 1000 };
const OLD: Ac[] = [['Two Sum', '2 days ago', '2100000002']];
const anchor = snap('2026-11-23T23:45:00Z', { solved: 100, recent: OLD });
const lc = (daySnapshots: LeetcodeSnapshotRecord[], a: LeetcodeSnapshotRecord | null = anchor) =>
  leetcodeEvaluation({ anchor: a, daySnapshots, window: DAY, rules: DEFAULT_LEETCODE_RULES, graceSecs: LEETCODE_FINAL_GRACE_SECS }).evaluation;
const receipt = (providers: ReceiptInput['providers'], rule: ReceiptInput['rule'] = 'all') =>
  buildReceipt({ challenge: 'A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J', member: 'Mm5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', day: 0, window: DAY, rulesHash: 'ab'.repeat(32), rule, providers });

describe('LeetCode through the engine', () => {
  it('a real solve the same day verifies (confidence 100 with a fresh anchor)', () => {
    const e = lc([snap('2026-11-24T10:30:00Z', { solved: 101, recent: [['Merge Intervals', '15 minutes ago', '2200000001'], ...OLD] })]);
    expect(e).toMatchObject({ outcome: 'met', value: 1, quality: { coveragePct: 100 } });
    expect(e.evidence).toEqual([{ id: '2200000001', counted: true, code: 'new-solve', value: 1, ref: 'Merge Intervals' }]);
    expect(receipt([e])).toMatchObject({ verdict: 'verified', confidence: 100 });
  });

  it('a solve in the last minutes is seen by the snapshot after the day ends; one after the end is not', () => {
    const after = snap('2026-11-25T00:15:00Z', {
      solved: 102,
      recent: [['Jump Game', '5 minutes ago', '2200000009'], ['Merge Intervals', '25 minutes ago', '2200000001'], ...OLD],
    });
    const e = lc([after]);
    expect(e.outcome).toBe('met');
    expect(e.evidence.find((x) => x.id === '2200000001')).toMatchObject({ counted: true, code: 'new-solve' });
    expect(e.evidence.find((x) => x.id === '2200000009')).toMatchObject({ counted: false, code: 'after-the-day' });
  });

  it('not met is only final when a snapshot reaches the end of the day', () => {
    const noon = lc([snap('2026-11-24T12:00:00Z', { solved: 100, recent: OLD })]);
    expect(noon).toMatchObject({ outcome: 'not_met', quality: { coveragePct: 50 } });
    expect(receipt([noon]).verdict).toBe('indeterminate');
    const end = lc([snap('2026-11-25T00:15:00Z', { solved: 100, recent: OLD })]);
    expect(receipt([end])).toMatchObject({ verdict: 'failed', confidence: 100, reason: 'goal-not-reached' });
  });

  it('old-problem re-solve: no credit, and a full-day read fails the day', () => {
    const e = lc([snap('2026-11-25T00:15:00Z', { solved: 100, recent: [['Two Sum', '3 hours ago', '2200000005'], ...OLD] })]);
    expect(e.value).toBe(0);
    expect(receipt([e]).verdict).toBe('failed');
  });

  it('scrape failure -> INDETERMINATE', () => {
    const e = lc([{ observedAt: '2026-11-25T00:15:00Z', readable: false, snapshot: null }]);
    expect(e.outcome).toBe('unknown');
    expect(receipt([e])).toMatchObject({ verdict: 'indeterminate', reason: 'could-not-read' });
  });

  it('private profile -> FAILED once confirmed by two hidden snapshots 25+ min apart; one alone is not enough', () => {
    const hidden = (at: string) => snap(at, { solved: 100, recent: [], history: false });
    expect(receipt([lc([hidden('2026-11-24T20:00:00Z')])])).toMatchObject({ verdict: 'indeterminate', reason: 'low-confidence' });
    expect(receipt([lc([hidden('2026-11-24T20:00:00Z'), hidden('2026-11-24T20:30:00Z')])])).toMatchObject({ verdict: 'failed', reason: 'rule-broken' });
    expect(receipt([lc([hidden('2026-11-24T20:00:00Z'), hidden('2026-11-24T20:10:00Z')])]).verdict).toBe('indeterminate');
  });

  it('a page without a solved count is a layout problem, never a hidden profile', () => {
    const odd = (at: string) => snap(at, { solved: null, recent: [], history: false });
    const e = lc([odd('2026-11-24T20:00:00Z'), odd('2026-11-24T21:00:00Z')]);
    expect(e.outcome).toBe('unknown');
    expect(receipt([e]).verdict).toBe('indeterminate');
  });

  it('an old anchor lowers confidence in a met day; unreadable snapshots during the day too', () => {
    const stale = snap('2026-11-23T12:00:00Z', { solved: 100, recent: OLD });
    const later = snap('2026-11-24T10:30:00Z', { solved: 101, recent: [['Merge Intervals', '15 minutes ago', '2200000001'], ...OLD] });
    expect(lc([later], stale).quality.coveragePct).toBe(75);
    const bad = { observedAt: '2026-11-24T05:00:00Z', readable: false, snapshot: null };
    expect(receipt([lc([bad, bad, later])]).confidence).toBe(80);
  });
});

describe('GitHub through the engine', () => {
  const day = (over: Partial<GithubDayResult>): GithubDayResult => ({
    meaningfulLines: 20,
    meetsThreshold: true,
    breakdown: { code: 20, docs: 0, docsCredited: 0, generated: 0, generatedCredited: 0 },
    counted: [{ sha: 'aaa111', repo: 'ana/api', meaningfulLines: 20, diffHash: 'h' }],
    skipped: [
      { sha: 'bbb222', repo: 'ana/api', reason: 'merge-commit' },
      { sha: 'ccc333', repo: 'ana/api', reason: 'outside-day' },
    ],
    anomalies: [],
    missingPatches: 0,
    ...over,
  });
  it('maps counted and skipped commits (not ones outside the day)', () => {
    const e = githubEvaluation(day({}), { complete: true }, 15);
    expect(e.evidence).toEqual([
      { id: 'aaa111', counted: true, code: 'counted', value: 20, ref: 'ana/api' },
      { id: 'bbb222', counted: false, code: 'merge-commit', ref: 'ana/api' },
    ]);
    expect(receipt([e])).toMatchObject({ verdict: 'verified', confidence: 100 });
  });
  it('an incomplete read can verify, but never fail', () => {
    expect(receipt([githubEvaluation(day({}), { complete: false }, 15)])).toMatchObject({ verdict: 'verified', confidence: 60 });
    expect(receipt([githubEvaluation(day({ meetsThreshold: false, meaningfulLines: 3 }), { complete: false }, 15)]).verdict).toBe('indeterminate');
    expect(receipt([githubEvaluation(day({ meetsThreshold: false, meaningfulLines: 3, missingPatches: 3 }), { complete: true }, 15)]).verdict).toBe('indeterminate');
  });
  it('ANY: GitHub met + LeetCode unreadable verifies; ALL: indeterminate', () => {
    const gh = githubEvaluation(day({}), { complete: true }, 15);
    const unread = lc([{ observedAt: '2026-11-24T10:00:00Z', readable: false, snapshot: null }]);
    expect(receipt([gh, unread], 'any').verdict).toBe('verified');
    expect(receipt([gh, unread], 'all').verdict).toBe('indeterminate');
  });
});
