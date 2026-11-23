import { describe, expect, it } from 'vitest';
import { buildReceipt, combineDay, CONFIDENCE, providerConfidence, ReceiptError, sealReceipt, verifyReceipt, type ProviderEvaluation, type ReceiptInput, type ScoredProvider } from './rules-engine.js';

const full = { complete: true, gaps: 0, coveragePct: 100 };
const s = (provider: ScoredProvider['provider'], outcome: ScoredProvider['outcome'], confidence = 100): ScoredProvider => ({ provider, outcome, confidence });

describe('confidence score', () => {
  it('is 100 for complete data and 0 for unreadable data', () => {
    expect(providerConfidence('met', full)).toBe(100);
    expect(providerConfidence('unknown', full)).toBe(0);
  });
  it('scales with coverage, drops for incomplete data and gaps (capped), and stays in 0-100', () => {
    expect(providerConfidence('met', { complete: true, gaps: 0, coveragePct: 75 })).toBe(75);
    expect(providerConfidence('met', { complete: false, gaps: 0, coveragePct: 100 })).toBe(60);
    expect(providerConfidence('met', { complete: true, gaps: 2, coveragePct: 100 })).toBe(80);
    expect(providerConfidence('met', { complete: true, gaps: 99, coveragePct: 100 })).toBe(70);
    expect(providerConfidence('met', { complete: false, gaps: 9, coveragePct: 10 })).toBe(0);
    expect(providerConfidence('met', { complete: true, gaps: -5, coveragePct: 400 })).toBe(100);
  });
});

describe('ANY / ALL', () => {
  it('ANY: one met provider verifies; all read and short fails; otherwise indeterminate', () => {
    expect(combineDay('any', [s('github', 'met'), s('leetcode', 'not_met')])).toEqual({ verdict: 'verified', confidence: 100, reason: 'one-met' });
    expect(combineDay('any', [s('github', 'met', 60), s('leetcode', 'unknown', 0)]).verdict).toBe('verified');
    expect(combineDay('any', [s('github', 'not_met'), s('leetcode', 'not_met')])).toEqual({ verdict: 'failed', confidence: 100, reason: 'goal-not-reached' });
    expect(combineDay('any', [s('github', 'not_met'), s('leetcode', 'unknown', 0)])).toEqual({ verdict: 'indeterminate', confidence: 0, reason: 'could-not-read' });
    expect(combineDay('any', [s('github', 'not_met'), s('leetcode', 'failed')]).reason).toBe('rule-broken');
  });
  it('ANY: the most confident met provider decides confidence', () => {
    expect(combineDay('any', [s('github', 'met', 55), s('leetcode', 'met', 90)]).confidence).toBe(90);
  });
  it('ALL: every provider must meet; one definite shortfall fails; unreadable is indeterminate', () => {
    expect(combineDay('all', [s('github', 'met', 90), s('leetcode', 'met', 70)])).toEqual({ verdict: 'verified', confidence: 70, reason: 'all-met' });
    expect(combineDay('all', [s('github', 'met'), s('leetcode', 'not_met')])).toEqual({ verdict: 'failed', confidence: 100, reason: 'goal-not-reached' });
    expect(combineDay('all', [s('github', 'met'), s('leetcode', 'unknown', 0)])).toEqual({ verdict: 'indeterminate', confidence: 0, reason: 'could-not-read' });
    expect(combineDay('all', [s('github', 'unknown', 0), s('leetcode', 'failed')]).verdict).toBe('failed');
  });
  it('no providers is indeterminate', () => {
    expect(combineDay('all', [])).toEqual({ verdict: 'indeterminate', confidence: 0, reason: 'no-providers' });
  });
});

describe('score boundaries', () => {
  it(`verified needs >= ${CONFIDENCE.verifyMin}`, () => {
    expect(combineDay('any', [s('github', 'met', 50)]).verdict).toBe('verified');
    expect(combineDay('any', [s('github', 'met', 49)])).toEqual({ verdict: 'indeterminate', confidence: 49, reason: 'low-confidence' });
  });
  it(`failed needs >= ${CONFIDENCE.failMin}`, () => {
    expect(combineDay('any', [s('github', 'not_met', 80)]).verdict).toBe('failed');
    expect(combineDay('any', [s('github', 'not_met', 79)])).toEqual({ verdict: 'indeterminate', confidence: 79, reason: 'low-confidence' });
  });
  it('end to end through quality: 50%/49% and 80%/79% coverage', () => {
    const one = (outcome: ProviderEvaluation['outcome'], coveragePct: number) =>
      buildReceipt({ ...BASE, rule: 'any', providers: [{ ...GITHUB, outcome, quality: { complete: true, gaps: 0, coveragePct } }] }).verdict;
    expect(one('met', 50)).toBe('verified');
    expect(one('met', 49)).toBe('indeterminate');
    expect(one('not_met', 80)).toBe('failed');
    expect(one('not_met', 79)).toBe('indeterminate');
    // incomplete GitHub data (60) can verify a day but never fail one
    const incomplete = (outcome: ProviderEvaluation['outcome']) => buildReceipt({ ...BASE, providers: [{ ...GITHUB, outcome, quality: { complete: false, gaps: 1, coveragePct: 100 } }] });
    expect(incomplete('met')).toMatchObject({ verdict: 'verified', confidence: 50 });
    expect(incomplete('not_met')).toMatchObject({ verdict: 'indeterminate', confidence: 50 });
  });
});

const BASE: ReceiptInput = {
  challenge: 'A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J',
  member: 'Mm5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa',
  day: 2,
  window: { startSec: 1_795_000_000, endSec: 1_795_086_400 },
  rulesHash: 'ab'.repeat(32),
  rule: 'all',
  providers: [],
};
const GITHUB: ProviderEvaluation = {
  provider: 'github',
  outcome: 'met',
  value: 42,
  goal: 15,
  quality: full,
  evidence: [
    { id: 'f00dbabe', counted: true, code: 'counted', value: 30, ref: 'ana/api' },
    { id: 'c0ffee00', counted: true, code: 'counted', value: 12, ref: 'ana/api' },
    { id: 'deadbeef', counted: false, code: 'merge-commit', ref: 'ana/api' },
  ],
};
const LEETCODE: ProviderEvaluation = {
  provider: 'leetcode',
  outcome: 'met',
  value: 1,
  goal: 1,
  quality: { complete: true, gaps: 0, coveragePct: 90 },
  evidence: [{ id: '2200000001', counted: true, code: 'new-solve', value: 1, ref: 'Merge Intervals' }],
};
const INPUT: ReceiptInput = { ...BASE, providers: [GITHUB, LEETCODE] };
/** Golden value: changing it means every past receipt's hash changes (bump RECEIPT_VERSION). */
const GOLDEN_HASH = '5ceb7001f738073452467a90680aad7ae2fe169e244fbef8aed1ea1471d23cba';

describe('deterministic receipts', () => {
  it('records the verdict, confidence and per-provider facts', () => {
    const r = buildReceipt(INPUT);
    expect(r).toMatchObject({ v: 1, verdict: 'verified', confidence: 90, reason: 'all-met', window: { start: 1_795_000_000, end: 1_795_086_400 } });
    expect(r.providers.map((p) => [p.provider, p.confidence])).toEqual([['github', 100], ['leetcode', 90]]);
    expect(r.providers[0]!.evidence.map((e) => e.id)).toEqual(['c0ffee00', 'deadbeef', 'f00dbabe']);
  });

  it('same input gives the same bytes and hash, whatever the order', async () => {
    const a = await sealReceipt(buildReceipt(INPUT));
    const shuffled: ReceiptInput = { ...INPUT, providers: [{ ...LEETCODE }, { ...GITHUB, evidence: [...GITHUB.evidence].reverse() }] };
    const b = await sealReceipt(buildReceipt(shuffled));
    expect(b.json).toBe(a.json);
    expect(b.evidenceHash).toBe(a.evidenceHash);
    expect(a.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the golden hash', async () => {
    expect((await sealReceipt(buildReceipt(INPUT))).evidenceHash).toBe(GOLDEN_HASH);
  });

  it('any change in the facts changes the hash', async () => {
    const base = (await sealReceipt(buildReceipt(INPUT))).evidenceHash;
    const variants: ReceiptInput[] = [
      { ...INPUT, day: 3 },
      { ...INPUT, rule: 'any' },
      { ...INPUT, rulesHash: 'cd'.repeat(32) },
      { ...INPUT, providers: [{ ...GITHUB, value: 43 }, LEETCODE] },
      { ...INPUT, providers: [GITHUB, { ...LEETCODE, evidence: [{ ...LEETCODE.evidence[0]!, counted: false, code: 'withdrawn', value: undefined }] }] },
    ];
    for (const v of variants) expect((await sealReceipt(buildReceipt(v))).evidenceHash).not.toBe(base);
  });

  it('normalises text (NFC), so the same title typed two ways hashes the same', async () => {
    const composed = { ...INPUT, providers: [{ ...LEETCODE, evidence: [{ ...LEETCODE.evidence[0]!, ref: 'Café' }] }] };
    const decomposed = { ...INPUT, providers: [{ ...LEETCODE, evidence: [{ ...LEETCODE.evidence[0]!, ref: 'Café' }] }] };
    expect((await sealReceipt(buildReceipt(composed))).evidenceHash).toBe((await sealReceipt(buildReceipt(decomposed))).evidenceHash);
  });

  it('collapses exact duplicates and rejects conflicting ones', () => {
    const dup = buildReceipt({ ...INPUT, providers: [{ ...GITHUB, evidence: [...GITHUB.evidence, GITHUB.evidence[0]!] }] });
    expect(dup.providers[0]!.evidence).toHaveLength(3);
    expect(() => buildReceipt({ ...INPUT, providers: [{ ...GITHUB, evidence: [...GITHUB.evidence, { ...GITHUB.evidence[0]!, value: 999 }] }] })).toThrow(/appears twice with different facts/);
  });

  it('rejects malformed input with a specific message', () => {
    expect(() => buildReceipt({ ...INPUT, day: 1.5 })).toThrow(ReceiptError);
    expect(() => buildReceipt({ ...INPUT, day: 60 })).toThrow(/day must be a whole number from 0 to 59/);
    expect(() => buildReceipt({ ...INPUT, rulesHash: 'AB'.repeat(32) })).toThrow(/rulesHash/);
    expect(() => buildReceipt({ ...INPUT, member: '0xabc' })).toThrow(/member/);
    expect(() => buildReceipt({ ...INPUT, providers: [GITHUB, GITHUB] })).toThrow(/appears twice/);
    expect(() => buildReceipt({ ...INPUT, providers: [{ ...GITHUB, value: Number.NaN }] })).toThrow(/github value/);
    expect(() => buildReceipt({ ...INPUT, providers: [{ ...GITHUB, evidence: [{ id: 'x', counted: true, code: 'Has Spaces' }] }] })).toThrow(/invalid code/);
    expect(() => buildReceipt({ ...INPUT, window: { startSec: 10, endSec: 10 } })).toThrow(/window.endSec/);
  });

  it('a stored receipt verifies, and any edit or non-canonical copy does not', async () => {
    const { json, evidenceHash } = await sealReceipt(buildReceipt(INPUT));
    expect(await verifyReceipt(json, evidenceHash)).toBe(true);
    expect(await verifyReceipt(json.replace('"value":42', '"value":420'), evidenceHash)).toBe(false);
    expect(await verifyReceipt(JSON.stringify(JSON.parse(json), null, 1), evidenceHash)).toBe(false);
    expect(await verifyReceipt('not json', evidenceHash)).toBe(false);
  });
});
