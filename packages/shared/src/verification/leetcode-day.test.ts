import { describe, expect, it } from 'vitest';
import { parseLeetcodeProfile } from './leetcode.js';
import { evaluateLeetcodeDay, explainLeetcodeDay, leetcodeDayOutcome, leetcodeRulesFromDocument, type LeetcodeSnapshotRecord } from './leetcode-day.js';

// Profile pages in the layout Firecrawl returned for a real profile (lee215, Phase 26).
type Ac = [title: string, ago: string, id: string];
function page(o: { solved: number; easy: number; medium: number; hard: number; recent: Ac[]; history?: boolean }) {
  return [
    'alice_99',
    `${o.solved}/4123`,
    '',
    'Solved',
    '',
    'Easy',
    '',
    `${o.easy}/978`,
    '',
    'Med.',
    '',
    `${o.medium}/2152`,
    '',
    'Hard',
    '',
    `${o.hard}/993`,
    '',
    ...(o.history === false ? [] : ['Recent AC', '', o.recent.map(([t, ago, id]) => `[${t}${ago}](https://leetcode.com/submissions/detail/${id}/)`).join(' ')]),
  ].join('\n');
}
const snap = (at: string, o: Parameters<typeof page>[0]): LeetcodeSnapshotRecord => ({ observedAt: at, readable: true, snapshot: parseLeetcodeProfile(page(o)) });

const DAY = { startSec: Date.parse('2026-11-24T00:00:00Z') / 1000, endSec: Date.parse('2026-11-25T00:00:00Z') / 1000 };
const OLD: Ac[] = [
  ['Two Sum', '2 days ago', '2100000002'],
  ['Valid Parentheses', '3 days ago', '2100000001'],
];
const anchor = snap('2026-11-23T23:45:00Z', { solved: 100, easy: 60, medium: 30, hard: 10, recent: OLD });

describe('LeetCode day', () => {
  it('real solve detected the same day (solved count up + new accepted title)', () => {
    const later = snap('2026-11-24T10:30:00Z', { solved: 101, easy: 60, medium: 31, hard: 10, recent: [['Merge Intervals', '15 minutes ago', '2200000001'], ...OLD] });
    const r = evaluateLeetcodeDay({ anchor, daySnapshots: [later], window: DAY });
    expect(r).toMatchObject({ status: 'ok', credited: 1, meetsThreshold: true, solvedDelta: 1, levels: { medium: 1 } });
    expect(r.newSolves).toEqual([{ submissionId: '2200000001', title: 'Merge Intervals' }]);
    expect(leetcodeDayOutcome(r)).toBe('verified');
  });

  it('FIXTURE scrape failure -> INDETERMINATE', () => {
    const r = evaluateLeetcodeDay({ anchor, daySnapshots: [{ observedAt: '2026-11-24T10:00:00Z', readable: false, snapshot: null }], window: DAY });
    expect(r.status).toBe('unreadable');
    expect(leetcodeDayOutcome(r)).toBe('indeterminate');
  });

  it('FIXTURE private profile (submission history hidden) -> FAILED', () => {
    const hidden = snap('2026-11-24T10:00:00Z', { solved: 101, easy: 60, medium: 31, hard: 10, recent: [], history: false });
    const r = evaluateLeetcodeDay({ anchor, daySnapshots: [hidden], window: DAY });
    expect(r.status).toBe('private');
    expect(leetcodeDayOutcome(r)).toBe('failed');
    expect(explainLeetcodeDay(r, leetcodeRulesFromDocument(null))[0]).toMatch(/submission history is hidden/);
  });

  it('FIXTURE old-problem re-solve -> no credit (new submission, solved count unchanged)', () => {
    // Re-solving "Two Sum" (in the anchor's list): a new submission id, same solved count.
    const resolve = snap('2026-11-24T11:00:00Z', { solved: 100, easy: 60, medium: 30, hard: 10, recent: [['Two Sum', '10 minutes ago', '2200000005'], ...OLD] });
    const r = evaluateLeetcodeDay({ anchor, daySnapshots: [resolve], window: DAY });
    expect(r).toMatchObject({ credited: 0, meetsThreshold: false });
    expect(r.ignored).toEqual([{ submissionId: '2200000005', title: 'Two Sum', reason: 'already-solved-recently' }]);
    expect(leetcodeDayOutcome(r)).toBe('failed');
    // Re-solving an older problem NOT in the recent list: a "new" title, but the count didn't move.
    const older = snap('2026-11-24T11:00:00Z', { solved: 100, easy: 60, medium: 30, hard: 10, recent: [['Climbing Stairs', '5 minutes ago', '2200000006'], ...OLD] });
    const r2 = evaluateLeetcodeDay({ anchor, daySnapshots: [older], window: DAY });
    expect(r2.credited).toBe(0);
    expect(explainLeetcodeDay(r2, leetcodeRulesFromDocument(null)).join(' ')).toMatch(/did not go up/);
  });

  it('withdrawn evidence: a solve seen earlier today that later vanishes is flagged and not credited', () => {
    const morning = snap('2026-11-24T09:00:00Z', { solved: 101, easy: 61, medium: 30, hard: 10, recent: [['Merge Intervals', '5 minutes ago', '2200000001'], ...OLD] });
    const evening = snap('2026-11-24T20:00:00Z', { solved: 100, easy: 60, medium: 30, hard: 10, recent: [['Another', '1 hour ago', '2200000009'], ...OLD] });
    const r = evaluateLeetcodeDay({ anchor, daySnapshots: [evening, morning], window: DAY });
    expect(r.withdrawn).toEqual([{ submissionId: '2200000001', title: 'Merge Intervals' }]);
    expect(r.countDecreased).toBe(true);
    expect(r.credited).toBe(0);
  });

  it('credit is the smaller of the solved increase and distinct new titles', () => {
    const two = snap('2026-11-24T18:00:00Z', {
      solved: 103,
      easy: 61,
      medium: 31,
      hard: 11,
      recent: [['A', '1 hour ago', '2200000003'], ['A', '2 hours ago', '2200000002'], ['B', '3 hours ago', '2200000001'], ...OLD],
    });
    expect(evaluateLeetcodeDay({ anchor, daySnapshots: [two], window: DAY }).credited).toBe(2);
  });

  it('minimum difficulty uses the per-difficulty counts', () => {
    const easyOnly = snap('2026-11-24T10:00:00Z', { solved: 101, easy: 61, medium: 30, hard: 10, recent: [['Easy One', '5 minutes ago', '2200000001'], ...OLD] });
    const rules = leetcodeRulesFromDocument({ minNewSolves: 1, minDifficulty: 'medium' });
    const r = evaluateLeetcodeDay({ anchor, daySnapshots: [easyOnly], window: DAY, rules });
    expect(r).toMatchObject({ credited: 1, creditedAtLevel: 0, meetsThreshold: false });
    expect(explainLeetcodeDay(r, rules).at(-1)).toBe('1 more new problem (Medium or Hard) needed today (0 of 1).');
  });

  it('a solve made before the day started (within the anchor gap) does not count today', () => {
    const early = snap('2026-11-24T00:20:00Z', { solved: 101, easy: 61, medium: 30, hard: 10, recent: [['Late Night', '30 minutes ago', '2200000001'], ...OLD] });
    const r = evaluateLeetcodeDay({ anchor, daySnapshots: [early], window: DAY });
    expect(r.ignored[0]?.reason).toBe('before-the-day');
    expect(r.credited).toBe(0);
  });

  it('no snapshot from before the day -> INDETERMINATE (never failed for our gap)', () => {
    const later = snap('2026-11-24T10:00:00Z', { solved: 101, easy: 61, medium: 30, hard: 10, recent: [['X', '5 minutes ago', '2200000001']] });
    const afterStart = { ...anchor, observedAt: '2026-11-24T00:10:00Z' };
    expect(leetcodeDayOutcome(evaluateLeetcodeDay({ anchor: null, daySnapshots: [later], window: DAY }))).toBe('indeterminate');
    expect(evaluateLeetcodeDay({ anchor: afterStart, daySnapshots: [later], window: DAY }).status).toBe('no_anchor');
    expect(evaluateLeetcodeDay({ anchor, daySnapshots: [], window: DAY }).status).toBe('no_data');
  });

  it('rules documents: new options, older documents, and limits', () => {
    expect(leetcodeRulesFromDocument({ minAcceptedPerDay: 1 })).toEqual({ minNewSolves: 1, minDifficulty: 'any' });
    expect(leetcodeRulesFromDocument({ minNewSolves: 9, minDifficulty: 'hard' })).toEqual({ minNewSolves: 5, minDifficulty: 'hard' });
  });
});

describe('stored snapshots', () => {
  it('round-trips a real-layout scrape, and stores the wrong page or a failure as unreadable', async () => {
    const { snapshotRowFromScrape, snapshotRecordFromRow } = await import('./leetcode-snapshot.js');
    const md = page({ solved: 101, easy: 60, medium: 31, hard: 10, recent: [['Merge Intervals', '15 minutes ago', '2200000001']] });
    const row = snapshotRowFromScrape({ ok: true, pageStatus: 200, markdown: md, title: 'alice_99 - LeetCode Profile' }, 'p1', 'Alice_99', 'manual');
    expect(row).toMatchObject({ handle: 'alice_99', readable: true, solved: 101, medium: 31, has_history: true, recent: [{ id: '2200000001', title: 'Merge Intervals', ago: '15 minutes ago' }] });
    const rec = snapshotRecordFromRow({ ...row, observed_at: '2026-11-24T10:30:00Z' });
    expect(rec.snapshot?.recentAccepted[0]).toMatchObject({ submissionId: '2200000001', approxAgeSeconds: 900 });
    expect(snapshotRowFromScrape({ ok: true, pageStatus: 200, markdown: md, title: 'LeetCode - Home' }, 'p1', 'alice_99', 'manual').readable).toBe(false);
    expect(snapshotRowFromScrape({ ok: false, pageStatus: null, markdown: '', title: null, error: 'timeout' }, 'p1', 'alice_99', 'scheduled')).toMatchObject({ readable: false, error: 'timeout' });
  });
});

describe('half-loaded profile pages', () => {
  it('a page with a solved count but no recent submissions is unreadable, not "nothing solved"', async () => {
    const { snapshotRowFromScrape } = await import('./leetcode-snapshot.js');
    const md = page({ solved: 1, easy: 1, medium: 0, hard: 0, recent: [] });
    const row = snapshotRowFromScrape({ ok: true, pageStatus: 200, markdown: md, title: 'alice_99 - LeetCode Profile' }, 'p1', 'alice_99', 'manual');
    expect(row).toMatchObject({ readable: false, error: 'the recent submissions list had not loaded' });
    // a brand-new account (nothing solved, empty list) is a normal readable page
    expect(snapshotRowFromScrape({ ok: true, pageStatus: 200, markdown: page({ solved: 0, easy: 0, medium: 0, hard: 0, recent: [] }), title: 'alice_99 - LeetCode Profile' }, 'p1', 'alice_99', 'manual').readable).toBe(true);
  });
});
