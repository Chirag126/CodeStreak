// Rules engine and day receipts (pure, isomorphic, deterministic).
//
// 1. Each provider (GitHub, LeetCode) reports what it saw for a member's day: an outcome, progress
//    toward its goal, the evidence it considered, and how good its data was (quality).
// 2. Quality becomes a confidence score (0-100, integers only).
// 3. The challenge's ANY/ALL rule combines the providers into one verdict, and confidence gates it:
//      - a FAILED day needs strong data  (confidence >= 80), otherwise it is INDETERMINATE;
//      - a VERIFIED day needs fair data  (confidence >= 50), otherwise it is INDETERMINATE.
//    Indeterminate never costs a stake, so shaky data can't fail anyone, and can't pass a cheat either.
// 4. The receipt is the canonical JSON of the facts behind the verdict (codes, counts, ids: never
//    display text or check times), and its SHA-256 is the evidence hash recorded on-chain. The same
//    facts in any order always give the same bytes and the same hash.
import { canonicalJson, sha256Hex } from './canonical.js';

export type RuleProvider = 'github' | 'leetcode';
export type ProviderRule = 'any' | 'all';
/** met: goal reached. not_met: fully read, goal not reached. failed: a challenge rule was broken
 *  (e.g. LeetCode history hidden). unknown: the data couldn't be read. */
export type ProviderOutcome = 'met' | 'not_met' | 'failed' | 'unknown';
export type DayVerdict = 'verified' | 'failed' | 'indeterminate';
export type VerdictReason =
  | 'all-met'
  | 'one-met'
  | 'goal-not-reached'
  | 'rule-broken'
  | 'could-not-read'
  | 'low-confidence'
  | 'no-providers';

export const CONFIDENCE = {
  /** Lowest confidence at which a day can be verified. */
  verifyMin: 50,
  /** Lowest confidence at which a day can be failed. */
  failMin: 80,
  /** Confidence of data that was read but is incomplete (before coverage and gaps). */
  incompleteBase: 60,
  /** Each gap (unreadable snapshot, missing patch) costs this much, up to `maxGapPenalty`. */
  gapPenalty: 10,
  maxGapPenalty: 30,
} as const;

export interface ProviderQuality {
  /** Everything needed was read. */
  complete: boolean;
  /** Holes in the data: files GitHub didn't return, snapshots that couldn't be read. */
  gaps: number;
  /** How well the data covers what the outcome depends on, in percent (0-100). */
  coveragePct: number;
}

/**
 * Confidence in a provider's outcome, 0-100:
 *   (complete ? 100 : 60) × coverage% − min(30, 10 × gaps), clamped; unknown outcomes are 0.
 */
export function providerConfidence(outcome: ProviderOutcome, q: ProviderQuality): number {
  if (outcome === 'unknown') return 0;
  const base = q.complete ? 100 : CONFIDENCE.incompleteBase;
  const coverage = clampInt(q.coveragePct, 0, 100);
  const penalty = Math.min(CONFIDENCE.maxGapPenalty, CONFIDENCE.gapPenalty * clampInt(q.gaps, 0, 1000));
  return clampInt(Math.floor((base * coverage) / 100) - penalty, 0, 100);
}

export interface ScoredProvider {
  provider: RuleProvider;
  outcome: ProviderOutcome;
  confidence: number;
}

export interface CombinedDay {
  verdict: DayVerdict;
  confidence: number;
  reason: VerdictReason;
}

/**
 * Combines the providers under the challenge's rule.
 *   ANY: verified if one provider met its goal (the most confident one decides confidence);
 *        failed only if every provider was read and none met it.
 *   ALL: verified only if every provider met its goal (the least confident decides);
 *        failed as soon as one provider is definitely short (the most confident short one decides).
 * Then the confidence gate turns a weak verified/failed into indeterminate.
 */
export function combineDay(rule: ProviderRule, providers: ScoredProvider[]): CombinedDay {
  if (providers.length === 0) return { verdict: 'indeterminate', confidence: 0, reason: 'no-providers' };
  const c = (p: ScoredProvider) => clampInt(p.confidence, 0, 100);
  const short = providers.filter((p) => p.outcome === 'not_met' || p.outcome === 'failed');
  const met = providers.filter((p) => p.outcome === 'met');
  const shortReason = (ps: ScoredProvider[]): VerdictReason => (ps.some((p) => p.outcome === 'failed') ? 'rule-broken' : 'goal-not-reached');

  let candidate: CombinedDay;
  if (rule === 'any') {
    if (met.length) candidate = { verdict: 'verified', confidence: Math.max(...met.map(c)), reason: providers.length === 1 ? 'all-met' : 'one-met' };
    else if (short.length === providers.length) candidate = { verdict: 'failed', confidence: Math.min(...short.map(c)), reason: shortReason(short) };
    else return { verdict: 'indeterminate', confidence: Math.min(...providers.map(c)), reason: 'could-not-read' };
  } else {
    if (met.length === providers.length) candidate = { verdict: 'verified', confidence: Math.min(...met.map(c)), reason: 'all-met' };
    else if (short.length) {
      const strongest = Math.max(...short.map(c));
      candidate = { verdict: 'failed', confidence: strongest, reason: shortReason(short.filter((p) => c(p) === strongest)) };
    } else return { verdict: 'indeterminate', confidence: Math.min(...providers.map(c)), reason: 'could-not-read' };
  }

  const min = candidate.verdict === 'verified' ? CONFIDENCE.verifyMin : CONFIDENCE.failMin;
  return candidate.confidence >= min ? candidate : { verdict: 'indeterminate', confidence: candidate.confidence, reason: 'low-confidence' };
}

// ---------------------------------------------------------------- receipts

export const RECEIPT_VERSION = 1;
export const RULES_ENGINE_ID = 'codestreak-rules/1';
export const MAX_RECEIPT_EVIDENCE = 200;

export interface ReceiptEvidence {
  /** Commit SHA or LeetCode submission id. */
  id: string;
  counted: boolean;
  /** Machine reason, e.g. "counted", "merge", "already-solved-recently". */
  code: string;
  /** Lines (GitHub) or 1 (LeetCode) when counted. */
  value?: number;
  /** Repository (GitHub) or problem title (LeetCode). */
  ref?: string;
}

export interface ProviderEvaluation {
  provider: RuleProvider;
  outcome: ProviderOutcome;
  /** Progress toward the goal: meaningful lines or new problems. */
  value: number;
  goal: number;
  quality: ProviderQuality;
  evidence: ReceiptEvidence[];
}

export interface ReceiptInput {
  /** Challenge PDA (base58). */
  challenge: string;
  /** The member's wallet (base58), as recorded on-chain. */
  member: string;
  day: number;
  window: { startSec: number; endSec: number };
  /** The challenge's on-chain rules fingerprint (64 hex). */
  rulesHash: string;
  rule: ProviderRule;
  providers: ProviderEvaluation[];
}

export interface DayReceipt {
  v: typeof RECEIPT_VERSION;
  engine: typeof RULES_ENGINE_ID;
  challenge: string;
  member: string;
  day: number;
  window: { start: number; end: number };
  rulesHash: string;
  rule: ProviderRule;
  verdict: DayVerdict;
  confidence: number;
  reason: VerdictReason;
  providers: {
    provider: RuleProvider;
    outcome: ProviderOutcome;
    value: number;
    goal: number;
    confidence: number;
    quality: { complete: boolean; gaps: number; coveragePct: number };
    evidence: { id: string; counted: boolean; code: string; value?: number; ref?: string }[];
    /** Evidence beyond MAX_RECEIPT_EVIDENCE (still reflected in value). */
    evidenceOmitted: number;
  }[];
}

export class ReceiptError extends Error {}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const CODE = /^[a-z0-9][a-z0-9-]{0,47}$/;
const PROVIDERS: readonly RuleProvider[] = ['github', 'leetcode'];
const OUTCOMES: readonly ProviderOutcome[] = ['met', 'not_met', 'failed', 'unknown'];

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}
function int(name: string, n: unknown, lo: number, hi: number): number {
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < lo || n > hi) throw new ReceiptError(`${name} must be a whole number from ${lo} to ${hi} (got ${String(n)}).`);
  return n;
}
const text = (s: string, max: number) => s.normalize('NFC').slice(0, max);

/** Builds the receipt: validates, normalises (NFC text, sorted, de-duplicated), scores and combines. */
export function buildReceipt(input: ReceiptInput): DayReceipt {
  if (!BASE58.test(input.challenge)) throw new ReceiptError('challenge must be a base58 address.');
  if (!BASE58.test(input.member)) throw new ReceiptError('member must be a base58 wallet address.');
  if (!HEX64.test(input.rulesHash)) throw new ReceiptError('rulesHash must be 64 lowercase hex characters.');
  if (input.rule !== 'any' && input.rule !== 'all') throw new ReceiptError('rule must be "any" or "all".');
  const day = int('day', input.day, 0, 59);
  const start = int('window.startSec', input.window.startSec, 0, 2 ** 40);
  const end = int('window.endSec', input.window.endSec, start + 1, 2 ** 40);

  const seen = new Set<RuleProvider>();
  const providers = input.providers
    .map((p) => {
      if (!PROVIDERS.includes(p.provider)) throw new ReceiptError(`unknown provider "${String(p.provider)}".`);
      if (seen.has(p.provider)) throw new ReceiptError(`provider "${p.provider}" appears twice.`);
      seen.add(p.provider);
      if (!OUTCOMES.includes(p.outcome)) throw new ReceiptError(`unknown outcome "${String(p.outcome)}" for ${p.provider}.`);
      const quality = {
        complete: p.quality.complete === true,
        gaps: int(`${p.provider} gaps`, p.quality.gaps, 0, 1000),
        coveragePct: int(`${p.provider} coveragePct`, p.quality.coveragePct, 0, 100),
      };
      const byId = new Map<string, DayReceipt['providers'][number]['evidence'][number]>();
      for (const e of p.evidence) {
        const id = text(String(e.id), 80);
        if (!id) throw new ReceiptError(`${p.provider} evidence has an empty id.`);
        if (!CODE.test(e.code)) throw new ReceiptError(`${p.provider} evidence ${id} has an invalid code "${e.code}".`);
        const item = {
          id,
          counted: e.counted === true,
          code: e.code,
          ...(e.value !== undefined ? { value: int(`${p.provider} evidence ${id} value`, e.value, 0, 1_000_000) } : {}),
          ...(e.ref !== undefined ? { ref: text(e.ref, 200) } : {}),
        };
        const prev = byId.get(id);
        if (prev && canonicalJson(prev) !== canonicalJson(item)) throw new ReceiptError(`${p.provider} evidence ${id} appears twice with different facts.`);
        byId.set(id, item);
      }
      const evidence = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return {
        provider: p.provider,
        outcome: p.outcome,
        value: int(`${p.provider} value`, p.value, 0, 1_000_000),
        goal: int(`${p.provider} goal`, p.goal, 1, 1_000_000),
        confidence: providerConfidence(p.outcome, quality),
        quality,
        evidence: evidence.slice(0, MAX_RECEIPT_EVIDENCE),
        evidenceOmitted: Math.max(0, evidence.length - MAX_RECEIPT_EVIDENCE),
      };
    })
    .sort((a, b) => (a.provider < b.provider ? -1 : 1));

  const combined = combineDay(input.rule, providers);
  return {
    v: RECEIPT_VERSION,
    engine: RULES_ENGINE_ID,
    challenge: input.challenge,
    member: input.member,
    day,
    window: { start, end },
    rulesHash: input.rulesHash,
    rule: input.rule,
    verdict: combined.verdict,
    confidence: combined.confidence,
    reason: combined.reason,
    providers,
  };
}

/** The exact bytes that are hashed (and stored), and their SHA-256: the on-chain evidence hash. */
export async function sealReceipt(receipt: DayReceipt): Promise<{ json: string; evidenceHash: string }> {
  const json = canonicalJson(receipt);
  return { json, evidenceHash: await sha256Hex(json) };
}

/** Anyone can re-check a stored receipt: same bytes, same hash, and the bytes are canonical. */
export async function verifyReceipt(json: string, evidenceHash: string): Promise<boolean> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return false;
  }
  return canonicalJson(parsed) === json && (await sha256Hex(json)) === evidenceHash;
}

/** Plain words for a verdict reason. */
export const VERDICT_REASON_TEXT: Record<VerdictReason, string> = {
  'all-met': 'Goal reached.',
  'one-met': 'Goal reached on one of the providers (this challenge needs any one).',
  'goal-not-reached': 'The goal was not reached.',
  'rule-broken': 'A challenge rule was broken (for example a hidden LeetCode profile).',
  'could-not-read': "The activity couldn't be read, so the day can't fail.",
  'low-confidence': "The data wasn't reliable enough to decide, so the day can't fail.",
  'no-providers': 'No provider to check.',
};
