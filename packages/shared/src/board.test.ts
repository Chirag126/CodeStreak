import { describe, expect, it } from 'vitest';
import { buildBoard, cellState, formatCountdown, memberState, type BoardInput, type BoardMemberInput } from './board.js';

const START = 1_800_000_000;
const DAY = 86_400;
const times = { state: 'open' as const, startTs: START, dayLengthSecs: DAY, numDays: 3, joinDeadlineTs: START - 3600, verifyWindowSecs: 3600, disputeWindowSecs: 3600 };

function member(over: Partial<BoardMemberInput> = {}): BoardMemberInput {
  return { membershipId: 'm', publicId: 'CS-AAAAAAAA', name: 'Ana', status: 'active', isViewer: false, isCreator: false, shareChecks: true, results: [], shieldDays: [], ...over };
}
function input(members: BoardMemberInput[]): BoardInput {
  return { times, minParticipants: 2, maxParticipants: 10, poolTotal: '30000000', boardVisibility: 'viewers', membersVisible: true, memberCount: members.length, members };
}

describe('cells', () => {
  const m = member({ results: [{ day: 0, result: 'verified' }, { day: 1, result: 'failed' }], shieldDays: [1] });
  it('maps results, Shields and time', () => {
    expect(cellState(m, 0, 2, false)).toBe('verified');
    expect(cellState(m, 1, 2, false)).toBe('shielded');
    expect(cellState(m, 2, 2, false)).toBe('today');
    expect(cellState(member(), 0, 2, false)).toBe('pending'); // day over, no result yet
    expect(cellState(member(), 2, 1, false)).toBe('upcoming');
    expect(cellState(member(), 2, null, true)).toBe('pending'); // challenge over, result missing
  });
});

describe('member state', () => {
  it('is out after an unshielded failed day, in when Shielded', () => {
    expect(memberState(member({ results: [{ day: 0, result: 'failed' }] }))).toBe('out');
    expect(memberState(member({ results: [{ day: 0, result: 'failed' }], shieldDays: [0] }))).toBe('in');
    expect(memberState(member({ results: [{ day: 0, result: 'indeterminate' }] }))).toBe('in');
    expect(memberState(member({ status: 'survived' }))).toBe('survived');
    expect(memberState(member({ status: 'voided' }))).toBe('voided');
  });
});

describe('board', () => {
  const ana = member({ membershipId: 'a', name: 'Ana', results: [{ day: 0, result: 'verified' }, { day: 1, result: 'verified' }] });
  const bo = member({ membershipId: 'b', name: 'Bo', results: [{ day: 0, result: 'failed' }] });
  const cy = member({ membershipId: 'c', name: 'Cy', results: [{ day: 0, result: 'failed' }, { day: 1, result: 'verified' }], shieldDays: [0] });

  it('counts survivors, the out and who is done today, and sorts the grid', () => {
    const b = buildBoard(input([bo, cy, ana]), START + DAY + 100); // day 2 (index 1)
    expect(b.phase).toBe('active');
    expect(b.day).toBe(1);
    expect(b.stillIn).toBe(2);
    expect(b.out).toBe(1);
    expect(b.doneToday).toBe(2);
    expect(b.members.map((m) => m.name)).toEqual(['Ana', 'Cy', 'Bo']);
    expect(b.members[0]!.cells).toEqual(['verified', 'verified', 'upcoming']);
    expect(b.members[1]!.shieldsUsed).toBe(1);
  });

  it('counts down to the next milestone in each phase', () => {
    expect(buildBoard(input([]), START - 7200).countdown).toEqual({ label: 'Joining closes', targetTs: START - 3600 });
    expect(buildBoard(input([]), START - 60).countdown).toEqual({ label: 'Starts', targetTs: START });
    expect(buildBoard(input([]), START + DAY + 5).countdown).toEqual({ label: 'Day 2 ends', targetTs: START + 2 * DAY });
    expect(buildBoard(input([]), START + 3 * DAY + 5).countdown?.label).toBe('Final checks close');
    expect(buildBoard(input([]), START + 3 * DAY + 3605).countdown?.label).toBe('Disputes close');
    expect(buildBoard(input([]), START + 3 * DAY + 7300).countdown).toBeNull();
    expect(buildBoard({ ...input([]), times: { ...times, state: 'cancelled' } }, START).statusLabel).toBe('Cancelled');
    // players of a cancelled challenge are refunded, not "still in"
    expect(buildBoard({ ...input([member({})]), times: { ...times, state: 'cancelled' } }, START).members[0]!.state).toBe('voided');
  });

  it('formats countdowns', () => {
    expect(formatCountdown(2 * DAY + 4 * 3600 + 30)).toBe('2d 4h');
    expect(formatCountdown(3 * 3600 + 5 * 60)).toBe('3h 05m');
    expect(formatCountdown(249)).toBe('4m 09s');
    expect(formatCountdown(-5)).toBe('0s');
  });
});

describe('checkable day', () => {
  it('is the running day, then the last day during final checks, then nothing', async () => {
    const { checkableDay } = await import('./board.js');
    expect(checkableDay(times, START - 1)).toEqual({ ok: false, reason: 'not_started' });
    expect(checkableDay(times, START + DAY + 5)).toEqual({ ok: true, day: 1, window: { startSec: START + DAY, endSec: START + 2 * DAY } });
    expect(checkableDay(times, START + 3 * DAY + 60)).toMatchObject({ ok: true, day: 2 });
    expect(checkableDay(times, START + 3 * DAY + 3600)).toEqual({ ok: false, reason: 'over' });
    expect(checkableDay({ ...times, state: 'cancelled' }, START + 5)).toEqual({ ok: false, reason: 'cancelled' });
  });
});

describe('done today', () => {
  it('counts a goal met at the latest check, by the ANY/ALL rule', async () => {
    const { goalMetAtCheck } = await import('./board.js');
    const checks = [{ day: 0, counted: 1, considered: 1, providers: ['github', 'leetcode'], progress: [
      { provider: 'github' as const, value: 20, goal: 15, outcome: 'met' as const },
      { provider: 'leetcode' as const, value: 0, goal: 1, outcome: 'not_met' as const },
    ] }];
    expect(goalMetAtCheck({ checks }, 0, { providers: ['github', 'leetcode'], rule: 'any' })).toBe(true);
    expect(goalMetAtCheck({ checks }, 0, { providers: ['github', 'leetcode'], rule: 'all' })).toBe(false);
    expect(goalMetAtCheck({ checks }, 1, { providers: ['github'], rule: 'any' })).toBe(false);
    expect(goalMetAtCheck({}, 0, { providers: ['github'], rule: 'any' })).toBe(false);
  });
});
