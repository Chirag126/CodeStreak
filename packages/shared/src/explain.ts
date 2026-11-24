// Phase 33 - why a recorded day passed, failed or became indeterminate, from its sealed receipt.
// Recomputes every confidence from the receipt's own inputs (quality → provider confidence → the
// ANY/ALL combination) so the page shows the engine's numbers, and flags a receipt whose stored
// numbers don't match (it would also fail its evidence hash).
import { combineDay, CONFIDENCE, providerConfidence, VERDICT_REASON_TEXT, type DayReceipt, type DayVerdict } from './rules-engine.js';
import { SKIP_REASON_TEXT } from './verification/github-explain.js';

const LEETCODE_CODE_TEXT: Record<string, string> = {
  'new-solve': 'New problem solved.',
  'not-credited': "Not credited: your solved count didn't rise by this much.",
  'already-solved-recently': 'A re-solve of a problem you had already solved.',
  'before-the-day': 'Solved before the day started.',
  'after-the-day': 'Solved after the day ended (counts for the next day).',
  withdrawn: 'Seen earlier, then disappeared from your profile.',
};

export function evidenceReason(provider: string, code: string): string {
  if (code === 'counted') return 'Counted.';
  if (provider === 'github') return (SKIP_REASON_TEXT as Record<string, string>)[code] ?? code;
  return LEETCODE_CODE_TEXT[code] ?? code;
}

export interface ProviderExplanation {
  provider: 'github' | 'leetcode';
  label: string;
  outcome: 'met' | 'not_met' | 'failed' | 'unknown';
  outcomeText: string;
  value: number;
  goal: number;
  unit: string;
  confidence: number;
  /** How the confidence was reached, in words. */
  confidenceWhy: string;
  counted: { id: string; ref?: string; value?: number }[];
  skipped: { id: string; ref?: string; reason: string }[];
  omitted: number;
}

export interface DayExplanation {
  day: number;
  verdict: DayVerdict;
  confidence: number;
  headline: string;
  reasonText: string;
  rule: 'any' | 'all';
  ruleText: string;
  /** Thresholds the confidence is compared with (for the meter). */
  thresholds: { verify: number; fail: number };
  /** One sentence on what the confidence gate did. */
  gateText: string;
  providers: ProviderExplanation[];
  /** The stored numbers equal a fresh recomputation. */
  consistent: boolean;
}

const OUTCOME_TEXT = { met: 'Goal reached', not_met: 'Goal not reached', failed: 'Rule broken', unknown: "Couldn't be read" } as const;

export function explainReceipt(r: DayReceipt): DayExplanation {
  let consistent = true;
  const providers: ProviderExplanation[] = r.providers.map((p) => {
    const recomputed = providerConfidence(p.outcome, p.quality);
    if (recomputed !== p.confidence) consistent = false;
    const base = p.quality.complete ? 100 : CONFIDENCE.incompleteBase;
    const penalty = Math.min(CONFIDENCE.maxGapPenalty, CONFIDENCE.gapPenalty * p.quality.gaps);
    const confidenceWhy =
      p.outcome === 'unknown'
        ? 'Nothing could be read, so confidence is 0.'
        : `${p.quality.complete ? 'Complete data' : `Incomplete data (starts at ${base})`} × ${p.quality.coveragePct}% coverage${penalty ? ` − ${penalty} for ${p.quality.gaps} gap${p.quality.gaps === 1 ? '' : 's'}` : ''} = ${recomputed}.`;
    return {
      provider: p.provider,
      label: p.provider === 'github' ? 'GitHub' : 'LeetCode',
      outcome: p.outcome,
      outcomeText: OUTCOME_TEXT[p.outcome],
      value: p.value,
      goal: p.goal,
      unit: p.provider === 'github' ? 'meaningful lines' : 'new problems',
      confidence: recomputed,
      confidenceWhy,
      counted: p.evidence.filter((e) => e.counted).map((e) => ({ id: e.id, ref: e.ref, value: e.value })),
      skipped: p.evidence.filter((e) => !e.counted).map((e) => ({ id: e.id, ref: e.ref, reason: evidenceReason(p.provider, e.code) })),
      omitted: p.evidenceOmitted,
    };
  });
  const combined = combineDay(
    r.rule,
    providers.map((p) => ({ provider: p.provider, outcome: p.outcome, confidence: p.confidence })),
  );
  if (combined.verdict !== r.verdict || combined.confidence !== r.confidence || combined.reason !== r.reason) consistent = false;

  const gateText =
    r.reason === 'low-confidence'
      ? `The data pointed to a ${r.providers.some((p) => p.outcome === 'met') ? 'pass' : 'fail'}, but ${r.confidence} is below the ${
          r.providers.some((p) => p.outcome === 'met') ? CONFIDENCE.verifyMin : CONFIDENCE.failMin
        } needed, so the day was not decided either way.`
      : r.verdict === 'verified'
        ? `Confidence ${r.confidence} ≥ ${CONFIDENCE.verifyMin} needed to verify.`
        : r.verdict === 'failed'
          ? `Confidence ${r.confidence} ≥ ${CONFIDENCE.failMin} needed to fail a day (a fail needs stronger proof than a pass).`
          : 'Undecided days never count as a fail.';

  return {
    day: r.day,
    verdict: r.verdict,
    confidence: r.confidence,
    headline: r.verdict === 'verified' ? `Day ${r.day + 1} passed` : r.verdict === 'failed' ? `Day ${r.day + 1} failed` : `Day ${r.day + 1} could not be decided`,
    reasonText: VERDICT_REASON_TEXT[r.reason],
    rule: r.rule,
    ruleText: providers.length < 2 ? '' : r.rule === 'any' ? 'Any one provider reaching its goal is enough.' : 'Every provider has to reach its goal.',
    thresholds: { verify: CONFIDENCE.verifyMin, fail: CONFIDENCE.failMin },
    gateText,
    providers,
    consistent,
  };
}
