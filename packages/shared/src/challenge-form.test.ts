import { describe, expect, it } from 'vitest';
import { rulesDocument, validateChallengeForm, validatePoolParams, type ChallengeFormInput } from './challenge-form.js';

const NOW = Math.floor(Date.parse('2026-11-22T10:00:00Z') / 1000);

const base: ChallengeFormInput = {
  title: 'Seven-day sprint',
  description: '',
  visibility: 'public',
  token: 'usdc',
  buyIn: '10',
  mode: 'real',
  durationDays: 7,
  startDate: '2026-11-25',
  providers: ['github'],
  providerRule: 'any',
  minLines: 15,
  minPlayers: 2,
  maxPlayers: 50,
  shieldsEnabled: true,
  shieldPrice: '2',
  maxShields: 1,
  shieldGraceMinutes: 120,
};
const check = (patch: Partial<ChallengeFormInput>) => validateChallengeForm({ ...base, ...patch }, NOW);

describe('create-challenge validation', () => {
  it('accepts a real-time challenge and builds program parameters', () => {
    const r = check({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params).toMatchObject({
      buyIn: 10_000_000n,
      startTs: Date.parse('2026-11-25T00:00:00Z') / 1000,
      joinDeadlineTs: Date.parse('2026-11-25T00:00:00Z') / 1000,
      dayLengthSecs: 86_400,
      numDays: 7,
      shieldPrice: 2_000_000n,
      maxShieldsPerParticipant: 1,
      shieldGraceSecs: 7200,
    });
  });

  it('accepts demo mode: compressed days starting soon, joining closing a minute before', () => {
    const r = check({ mode: 'demo', demoDayMinutes: 5, demoStartMinutes: 15, shieldGraceMinutes: 2 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.dayLengthSecs).toBe(300);
    expect(r.params.numDays).toBe(3);
    expect(r.params.startTs - r.params.joinDeadlineTs).toBe(60);
    expect(r.params.startTs).toBeGreaterThanOrEqual(NOW + 15 * 60);
  });

  it('SOL stakes use 9 decimals and SOL limits', () => {
    const r = check({ token: 'sol', buyIn: '0.5', shieldPrice: '0.1' });
    expect(r.ok && r.params.buyIn).toBe(500_000_000n);
    expect(check({ token: 'sol', buyIn: '0.001' })).toMatchObject({ ok: false, errors: { buyIn: 'Between 0.01 and 10 SOL.' } });
  });

  it('blocks invalid inputs with a message on the right field', () => {
    const cases: [Partial<ChallengeFormInput>, string][] = [
      [{ title: 'ab' }, 'title'],
      [{ buyIn: 'abc' }, 'buyIn'],
      [{ buyIn: '-5' }, 'buyIn'],
      [{ buyIn: '0.0000001' }, 'buyIn'],
      [{ buyIn: '5000' }, 'buyIn'],
      [{ durationDays: 5 as never }, 'durationDays'],
      [{ startDate: undefined }, 'startDate'],
      [{ startDate: '2026-11-20' }, 'startDate'], // in the past
      [{ startDate: '2027-06-01' }, 'startDate'], // beyond 90 days
      [{ providers: [] }, 'providers'],
      [{ minLines: 0 }, 'minLines'],
      [{ minPlayers: 1 }, 'minPlayers'],
      [{ minPlayers: 10, maxPlayers: 5 }, 'maxPlayers'],
      [{ maxPlayers: 5000 }, 'maxPlayers'],
      [{ shieldPrice: '0' }, 'shieldPrice'],
      [{ shieldPrice: '20' }, 'shieldPrice'], // more than the buy-in
      [{ maxShields: 4 }, 'maxShields'],
      [{ shieldGraceMinutes: 2000 }, 'shieldGraceMinutes'],
      [{ mode: 'demo', demoStartMinutes: 5 }, 'demoStartMinutes'],
      [{ mode: 'demo', demoDayMinutes: 2, shieldGraceMinutes: 3 }, 'shieldGraceMinutes'],
    ];
    for (const [patch, field] of cases) {
      const r = check(patch);
      expect(r.ok, JSON.stringify(patch)).toBe(false);
      expect(!r.ok && Object.keys(r.errors), JSON.stringify(patch)).toContain(field);
    }
  });

  it('turning Shields off sends price, count and grace as zero (the program requires it)', () => {
    const r = check({ shieldsEnabled: false, shieldPrice: '' });
    expect(r.ok && [r.params.shieldPrice, r.params.maxShieldsPerParticipant, r.params.shieldGraceSecs]).toEqual([0n, 0, 0]);
  });

  it('mirrors the program validation', () => {
    const r = check({});
    if (!r.ok) throw new Error('fixture invalid');
    const p = r.params;
    expect(validatePoolParams(p, NOW)).toBeNull();
    expect(validatePoolParams({ ...p, buyIn: 0n }, NOW)).toBe('InvalidBuyIn');
    expect(validatePoolParams({ ...p, dayLengthSecs: 59 }, NOW)).toBe('InvalidDayLength');
    expect(validatePoolParams({ ...p, numDays: 61 }, NOW)).toBe('InvalidNumDays');
    expect(validatePoolParams({ ...p, startTs: NOW }, NOW)).toBe('StartInPast');
    expect(validatePoolParams({ ...p, joinDeadlineTs: p.startTs + 1 }, NOW)).toBe('InvalidJoinDeadline');
    expect(validatePoolParams({ ...p, maxParticipants: 1001 }, NOW)).toBe('InvalidParticipantLimits');
    expect(validatePoolParams({ ...p, verifyWindowSecs: 59 }, NOW)).toBe('InvalidWindow');
    expect(validatePoolParams({ ...p, shieldPrice: 0n }, NOW)).toBe('InvalidShieldConfig');
    expect(validatePoolParams({ ...p, maxShieldsPerParticipant: 0 }, NOW)).toBe('InvalidShieldConfig');
  });

  it('rules document records providers and the ANY/ALL rule', () => {
    const r = check({ providers: ['leetcode', 'github'], providerRule: 'all', minLines: 30 });
    if (!r.ok) throw new Error('invalid');
    expect(rulesDocument(r.form)).toMatchObject({ providers: ['github', 'leetcode'], providerRule: 'all', github: { minMeaningfulLines: 30 }, leetcode: { minAcceptedPerDay: 1 } });
    const single = check({ providerRule: 'all' });
    if (!single.ok) throw new Error('invalid');
    expect(rulesDocument(single.form)).toMatchObject({ providerRule: 'any', leetcode: null });
  });
});

describe('GitHub options in the wizard (Phase 24)', () => {
  it('parses file types: extensions and exact file names', async () => {
    const { parseFileFilter } = await import('./challenge-form.js');
    expect(parseFileFilter('')).toEqual({ ok: true, extensions: [], filenames: [] });
    expect(parseFileFilter('.ts, py  main.py Makefile .TSX')).toEqual({ ok: true, extensions: ['.py', '.ts', '.tsx'], filenames: ['Makefile', 'main.py'] });
    expect(parseFileFilter('../etc/passwd').ok).toBe(false);
    expect(parseFileFilter('*.js').ok).toBe(false);
    expect(parseFileFilter(Array.from({ length: 21 }, (_, i) => `.e${i}`).join(' ')).ok).toBe(false);
  });
});

describe('selected repositories (Phase 24)', () => {
  it('parses owner/name lists and GitHub URLs, rejecting anything else', async () => {
    const { parseRepoList } = await import('./challenge-form.js');
    expect(parseRepoList('')).toEqual({ ok: true, repos: [] });
    expect(parseRepoList('acme/app, https://github.com/Chirag126/trust-dependency-mapper.git\nacme/APP')).toEqual({ ok: true, repos: ['acme/APP', 'Chirag126/trust-dependency-mapper'] });
    expect(parseRepoList('just-a-name').ok).toBe(false);
    expect(parseRepoList('acme/../etc').ok).toBe(false);
    expect(parseRepoList('a/1 a/2 a/3 a/4 a/5 a/6').ok).toBe(false);
  });
});
