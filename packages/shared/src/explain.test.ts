import { describe, expect, it } from 'vitest';
import { explainReceipt } from './explain.js';
import { buildReceipt, type ProviderEvaluation } from './rules-engine.js';

const base = { challenge: 'Cha11enge1111111111111111111111111111111111', member: 'A1ice11111111111111111111111111111111111111', day: 2, window: { startSec: 1000, endSec: 1600 }, rulesHash: 'ab'.repeat(32) };
const github = (o: Partial<ProviderEvaluation> = {}): ProviderEvaluation => ({
  provider: 'github',
  outcome: 'met',
  value: 42,
  goal: 20,
  quality: { complete: true, gaps: 0, coveragePct: 100 },
  evidence: [
    { id: 'aaa', counted: true, code: 'counted', value: 42, ref: 'me/repo' },
    { id: 'bbb', counted: false, code: 'merge-commit', ref: 'me/repo' },
  ],
  ...o,
});

describe('explainReceipt', () => {
  it('explains a pass with its confidence and the evidence', () => {
    const e = explainReceipt(buildReceipt({ ...base, rule: 'all', providers: [github()] }));
    expect(e).toMatchObject({ headline: 'Day 3 passed', verdict: 'verified', confidence: 100, consistent: true, reasonText: 'Goal reached.' });
    expect(e.providers[0]).toMatchObject({ outcomeText: 'Goal reached', value: 42, goal: 20, confidence: 100, counted: [{ id: 'aaa', value: 42 }] });
    expect(e.providers[0]!.skipped[0]!.reason).toMatch(/merge commit/i);
    expect(e.providers[0]!.confidenceWhy).toBe('Complete data × 100% coverage = 100.');
    expect(e.gateText).toBe('Confidence 100 ≥ 50 needed to verify.');
  });

  it('explains why a weak fail became indeterminate (confidence gate)', () => {
    // Incomplete data: 60 × 100% − 10 (one gap) = 50 < 80 needed to fail.
    const e = explainReceipt(buildReceipt({ ...base, rule: 'all', providers: [github({ outcome: 'not_met', value: 3, quality: { complete: false, gaps: 1, coveragePct: 100 }, evidence: [] })] }));
    expect(e).toMatchObject({ verdict: 'indeterminate', confidence: 50, headline: 'Day 3 could not be decided', consistent: true });
    expect(e.providers[0]!.confidenceWhy).toBe('Incomplete data (starts at 60) × 100% coverage − 10 for 1 gap = 50.');
    expect(e.gateText).toMatch(/50 is below the 80 needed/);
  });

  it('explains a confident fail and the ANY rule', () => {
    const e = explainReceipt(
      buildReceipt({
        ...base,
        rule: 'any',
        providers: [github({ outcome: 'not_met', value: 3, evidence: [] }), { provider: 'leetcode', outcome: 'not_met', value: 0, goal: 1, quality: { complete: true, gaps: 0, coveragePct: 100 }, evidence: [] }],
      }),
    );
    expect(e).toMatchObject({ verdict: 'failed', confidence: 100, consistent: true, ruleText: 'Any one provider reaching its goal is enough.' });
    expect(e.gateText).toMatch(/≥ 80 needed to fail/);
  });

  it('flags a receipt whose stored numbers were changed', () => {
    const r = buildReceipt({ ...base, rule: 'all', providers: [github()] });
    expect(explainReceipt({ ...r, confidence: 99 }).consistent).toBe(false);
    expect(explainReceipt({ ...r, providers: [{ ...r.providers[0]!, confidence: 12 }] }).consistent).toBe(false);
  });
});
