import { describe, expect, it } from 'vitest';
import { csvCell, filterHistory, historyCsv, historyOutcome, parseHistoryFilters, summarizeHistory, type HistoryRow } from './history.js';

const row = (over: Partial<HistoryRow> = {}): HistoryRow => ({
  key: 'm1',
  role: 'player',
  title: 'Ship daily',
  address: 'Addr1',
  token: 'usdc',
  startTs: 1_800_000_000,
  endTs: 1_800_000_000 + 7 * 86_400,
  numDays: 7,
  outcome: 'survived',
  verified: 7,
  failed: 0,
  shielded: 0,
  undecided: 0,
  put: 10_000_000n,
  received: 15_000_000n,
  badgeMint: 'Mint1',
  ...over,
});

describe('history outcome', () => {
  it('cancelled wins; players show their final status, else running / awaiting settlement', () => {
    expect(historyOutcome('player', 'survived', 'cancelled', 10, 0)).toBe('cancelled');
    expect(historyOutcome('player', 'failed', 'settled', 10, 20)).toBe('failed');
    expect(historyOutcome('player', 'active', 'open', 10, 5)).toBe('running');
    expect(historyOutcome('player', 'active', 'open', 10, 20)).toBe('awaiting_settlement');
    expect(historyOutcome('sponsor', 'active', 'open', 10, 5)).toBe('running');
    expect(historyOutcome('sponsor', 'active', 'settled', 10, 20)).toBe('sponsored');
  });
});

describe('filters', () => {
  it('parses untrusted query parameters, unknown values become "all"', () => {
    expect(parseHistoryFilters({ role: 'sponsor', outcome: 'failed', token: 'sol', q: '  ship ' })).toEqual({ role: 'sponsor', outcome: 'failed', token: 'sol', q: 'ship' });
    expect(parseHistoryFilters({ role: 'admin', outcome: '<script>', token: ['usdc', 'sol'], q: 'x'.repeat(200) })).toEqual({ role: 'all', outcome: 'all', token: 'usdc', q: 'x'.repeat(80) });
  });

  it('filters by role, outcome, token and title; newest first', () => {
    const rows = [row(), row({ key: 'm2', title: 'LeetCode week', outcome: 'failed', token: 'sol', startTs: 1_900_000_000 }), row({ key: 's1', role: 'sponsor', outcome: 'sponsored' })];
    expect(filterHistory(rows, {}).map((r) => r.key)).toEqual(['m2', 'm1', 's1']);
    expect(filterHistory(rows, { outcome: 'failed' }).map((r) => r.key)).toEqual(['m2']);
    expect(filterHistory(rows, { role: 'sponsor' }).map((r) => r.key)).toEqual(['s1']);
    expect(filterHistory(rows, { token: 'usdc', q: 'SHIP' }).map((r) => r.key)).toEqual(['m1', 's1']);
  });

  it('summarises outcomes, verified days and money per token', () => {
    const s = summarizeHistory([row(), row({ key: 'm2', outcome: 'failed', verified: 2, received: 0n }), row({ key: 'm3', token: 'sol', put: 5n, received: 5n })]);
    expect(s).toMatchObject({ challenges: 3, survived: 2, failed: 1, verifiedDays: 16 });
    expect(s.money.usdc).toEqual({ put: 20_000_000n, received: 15_000_000n });
    expect(s.money.sol).toEqual({ put: 5n, received: 5n });
  });
});

describe('CSV', () => {
  it('quotes, escapes and neutralises formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell(-3)).toBe('-3'); // numbers are numbers
  });

  it('exports one line per row with readable amounts, UTC times and a BOM', () => {
    const csv = historyCsv([row({ title: '@evil, title' })]);
    expect(csv.startsWith('﻿Role,Challenge,')).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(`"'@evil, title"`);
    expect(lines[1]).toContain(',USDC,2027-01-15 08:00 UTC,');
    expect(lines[1]).toContain(',Survived,7,0,0,0,10,15,Mint1');
  });
});
