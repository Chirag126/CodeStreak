// GitHub daily activity rules (node-only: uses node:crypto for diff hashing).
//
// Inputs are normalized commit records collected by the worker from the official REST API
// (PushEvent before/head -> Compare -> Commit; since Oct 2025 push events carry no commit list).
// Rules, including the holes found in Phase 2 real data:
//   1. Merge commits never count: they repeat the merged diff and are authored by whoever merged.
//   2. A commit counts once, even when it appears in several pushes (branch push + merge to main).
//   3. Identical changes count once, even under different SHAs (rebase, cherry-pick, copy to another repo).
//   4. Only commits whose GitHub author id is the user's id count (unlinked git emails don't count).
//   5. Forks don't count unless the creator allows them (and then only the user's own commits).
//   6. The qualifying day is the PUSH time (GitHub server clock), never the author date (user-controlled).
//   7. Only meaningful added lines count: blank, brace-only, comment-only, re-indented and moved lines
//      (an added line that matches a removed line in the same file) are not work.
//   8. Lockfiles, vendored/build output, minified and generated files, and docs don't count unless
//      the creator allows them, and then only up to a capped share of the daily goal.
//   9. Commits dated well before the day (old work pushed late) don't count unless the creator allows
//      a backdate allowance (hours). Dates are user-controlled, so this is a sanity check on top of 6.
//  10. An optional file filter (extensions and/or exact file names) limits what counts.
// Bulk commits are flagged as anomalies; they lower confidence instead of failing the day.
import { createHash } from 'node:crypto';
import { ELIGIBLE_EXTENSIONS, GITHUB_OPTION_LIMITS } from '../constants.js';

export { GITHUB_OPTION_LIMITS };

export interface GithubFile {
  filename: string;
  /** Unified diff from the Commit API; absent for large or binary diffs. */
  patch?: string | undefined;
}

export interface GithubCommit {
  sha: string;
  parentShas: string[];
  /** GitHub numeric user id of the commit author; null when the git email is not linked to any account. */
  authorId: number | null;
  /** Push time (ISO string, GitHub server clock, from repository activity). */
  pushedAt: string;
  /** GitHub id of who pushed it. Git author emails can be set to anyone's, the pusher can't. */
  pusherId?: number | null;
  /** Git author and committer dates (ISO, user-controlled). Missing = treated as the push time. */
  authoredAt?: string | undefined;
  committedAt?: string | undefined;
  repo: { id?: number; fullName: string; fork: boolean; ownerId: number };
  files: GithubFile[];
}

export interface GithubFileFilter {
  /** Lower-case extensions with the dot, e.g. ".ts". */
  extensions: string[];
  /** Exact file names (any folder), e.g. "main.py". Case-insensitive. */
  filenames: string[];
}

export interface GithubAllowances {
  /** README and other docs count, up to `docsCapShare` of the daily goal. */
  docs: boolean;
  /** Lockfiles, build output, minified and generated files count, up to `generatedCapShare` of the goal. */
  generated: boolean;
  /** The user's own commits in forks count. */
  forks: boolean;
  /** Commits dated up to this many hours before the day starts still count (0 = none). */
  backdateHours: number;
}

export interface GithubRules {
  minMeaningfulLines: number;
  /** A single commit above this many meaningful lines is flagged as a bulk commit. */
  bulkCommitLines: number;
  /** A single commit touching more than this many eligible files is flagged as a bulk commit. */
  bulkCommitFiles: number;
  /** When set, only matching files count (on top of the exclusions above). */
  fileFilter?: GithubFileFilter | null;
  /**
   * When set, only pushes to these repositories (numeric GitHub repo ids) count, whoever owns
   * them (a team repo): the user must still be the author and the pusher of each commit.
   */
  repos?: number[] | null;
  allow?: GithubAllowances;
}

export const STRICT_ALLOWANCES: GithubAllowances = { docs: false, generated: false, forks: false, backdateHours: 0 };
export const DEFAULT_GITHUB_RULES: GithubRules = { minMeaningfulLines: 15, bulkCommitLines: 400, bulkCommitFiles: 40, fileFilter: null, allow: STRICT_ALLOWANCES };


export type GithubSkipReason =
  | 'outside-day'
  | 'merge-commit'
  | 'author-mismatch'
  | 'author-unlinked'
  | 'pushed-by-other'
  | 'other-repo'
  | 'fork'
  | 'not-repo-owner'
  | 'backdated'
  | 'duplicate-sha'
  | 'duplicate-diff'
  | 'whitespace-only'
  | 'filtered-out'
  | 'no-eligible-changes';

export interface GithubDayResult {
  /** Lines credited toward the goal (code + capped docs + capped generated). */
  meaningfulLines: number;
  meetsThreshold: boolean;
  /** Code lines, and docs/generated lines before and after their caps. */
  breakdown: { code: number; docs: number; docsCredited: number; generated: number; generatedCredited: number };
  counted: { sha: string; repo: string; meaningfulLines: number; diffHash: string }[];
  skipped: { sha: string; repo: string; reason: GithubSkipReason }[];
  anomalies: { sha: string; kind: 'bulk-commit'; detail: string }[];
  /** Files whose patch GitHub omitted: their lines cannot be counted. */
  missingPatches: number;
}

// ---------------------------------------------------------------- files

export type FileKind = 'code' | 'docs' | 'generated' | 'other';

const LOCKFILES = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|go\.sum|poetry\.lock|Pipfile\.lock|uv\.lock|Gemfile\.lock|composer\.lock|Podfile\.lock|pubspec\.lock|mix\.lock|flake\.lock)$/i;
const BUILD_OUTPUT = /(^|\/)(node_modules|dist|build|out|\.next|\.nuxt|target|vendor|coverage|__pycache__|\.venv|venv)\//i;
const MINIFIED_NAME = /\.(min|bundle)\.(js|mjs|css)$|\.map$/i;
const DOCS = /(^|\/)(readme|changelog|license|contributing|code_of_conduct)(\.[a-z0-9]+)?$|\.(md|mdx|markdown|rst|txt|adoc)$/i;
const GENERATED_MARKER = /@generated|DO NOT EDIT|auto-generated|autogenerated/i;
/** A line this long means minified or generated output, not hand-written code. */
const MINIFIED_LINE = 400;

export function fileKind(filename: string): FileKind {
  if (LOCKFILES.test(filename) || BUILD_OUTPUT.test(filename) || MINIFIED_NAME.test(filename)) return 'generated';
  if (DOCS.test(filename)) return 'docs';
  const f = filename.toLowerCase();
  if (ELIGIBLE_EXTENSIONS.some((ext) => f.endsWith(ext))) return 'code';
  return 'other';
}

/** Code files that count by default (kept for compatibility). */
export function isEligibleFile(filename: string): boolean {
  return fileKind(filename) === 'code';
}

export function matchesFilter(filename: string, filter: GithubFileFilter | null | undefined): boolean {
  if (!filter || (filter.extensions.length === 0 && filter.filenames.length === 0)) return true;
  const base = (filename.split('/').pop() ?? filename).toLowerCase();
  return filter.extensions.some((ext) => base.endsWith(ext.toLowerCase())) || filter.filenames.some((n) => n.toLowerCase() === base);
}

// ---------------------------------------------------------------- lines

function isCommentOnly(line: string): boolean {
  return /^(\/\/|#(?!include|define|pragma)|\/\*|\*\/|\*(\s|$)|--|<!--)/.test(line);
}

function isPunctuationOnly(line: string): boolean {
  return /^[\s{}()[\];,.:<>/=-]*$/.test(line);
}

const normalize = (raw: string) => raw.trim().replace(/\s+/g, ' ');

/**
 * Meaningful added lines of one patch, normalized (trimmed, inner whitespace collapsed).
 * An added line that matches a removed line of the same patch (re-indented, reformatted or moved)
 * is not new work and is dropped. Generated markers or very long lines make the whole file count zero.
 */
export function meaningfulAddedLines(patch: string | undefined): { lines: string[]; generated: boolean; minified: boolean; cancelled: number; patchMissing: boolean } {
  if (typeof patch !== 'string') return { lines: [], generated: false, minified: false, cancelled: 0, patchMissing: true };
  const added: string[] = [];
  const removed = new Map<string, number>();
  let generated = false;
  let minified = false;
  for (const raw of patch.split('\n')) {
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    if (raw.startsWith('-')) {
      const line = normalize(raw.slice(1));
      if (line) removed.set(line, (removed.get(line) ?? 0) + 1);
      continue;
    }
    if (!raw.startsWith('+')) continue;
    const body = raw.slice(1);
    if (body.length > MINIFIED_LINE) minified = true;
    const line = normalize(body);
    if (GENERATED_MARKER.test(line)) generated = true;
    if (!line || isCommentOnly(line) || isPunctuationOnly(line)) continue;
    added.push(line);
  }
  let cancelled = 0;
  const lines: string[] = [];
  for (const line of added) {
    const n = removed.get(line) ?? 0;
    if (n > 0) {
      removed.set(line, n - 1);
      cancelled++;
    } else {
      lines.push(line);
    }
  }
  if (generated || minified) return { lines: [], generated, minified, cancelled, patchMissing: false };
  return { lines, generated, minified, cancelled, patchMissing: false };
}

/** Documentation lines: non-blank, not just markdown punctuation. */
function docLines(patch: string | undefined): string[] {
  if (typeof patch !== 'string') return [];
  const removed = new Set<string>();
  for (const raw of patch.split('\n')) if (raw.startsWith('-') && !raw.startsWith('---')) removed.add(normalize(raw.slice(1)));
  const out: string[] = [];
  for (const raw of patch.split('\n')) {
    if (!raw.startsWith('+') || raw.startsWith('+++')) continue;
    const line = normalize(raw.slice(1));
    if (!line || /^[#>*_=`|:\-\s]*$/.test(line) || removed.has(line)) continue;
    out.push(line);
  }
  return out;
}

/** Content hash of a commit's meaningful changes, independent of SHA, file path and repo. */
export function diffHash(fileLines: string[][]): string {
  const h = createHash('sha256');
  for (const lines of fileLines.map((l) => l.join('\n')).sort()) h.update(lines).update('\0');
  return h.digest('hex');
}

// ---------------------------------------------------------------- day

/**
 * Evaluates one challenge day.
 * `seen` carries SHAs and diff hashes already credited (earlier days, other challenges); it is updated in place.
 */
export function evaluateGithubDay(input: {
  commits: GithubCommit[];
  userGithubId: number;
  window: { startSec: number; endSec: number };
  rules?: GithubRules;
  seen: { shas: Set<string>; diffHashes: Set<string> };
}): GithubDayResult {
  const rules = input.rules ?? DEFAULT_GITHUB_RULES;
  const allow = rules.allow ?? STRICT_ALLOWANCES;
  const backdateLimitSec = input.window.startSec - Math.min(Math.max(0, allow.backdateHours), GITHUB_OPTION_LIMITS.maxBackdateHours) * 3600;
  const result: GithubDayResult = {
    meaningfulLines: 0,
    meetsThreshold: false,
    breakdown: { code: 0, docs: 0, docsCredited: 0, generated: 0, generatedCredited: 0 },
    counted: [],
    skipped: [],
    anomalies: [],
    missingPatches: 0,
  };

  // Oldest push first so the first occurrence of duplicated work is the one credited.
  const ordered = [...input.commits].sort((a, b) => Date.parse(a.pushedAt) - Date.parse(b.pushedAt));

  for (const c of ordered) {
    const skip = (reason: GithubSkipReason) => result.skipped.push({ sha: c.sha, repo: c.repo.fullName, reason });
    const pushedSec = Math.floor(Date.parse(c.pushedAt) / 1000);

    if (!(pushedSec >= input.window.startSec && pushedSec < input.window.endSec)) { skip('outside-day'); continue; }
    if (c.parentShas.length > 1) { skip('merge-commit'); continue; }
    // null: the git email isn't on any GitHub account; another id: someone else's account.
    if (c.authorId === null) { skip('author-unlinked'); continue; }
    if (c.authorId !== input.userGithubId) { skip('author-mismatch'); continue; }
    // Unknown pusher (undefined) only in old records; a known other pusher never counts.
    if (c.pusherId !== undefined && c.pusherId !== input.userGithubId) { skip('pushed-by-other'); continue; }
    if (rules.repos && rules.repos.length > 0) {
      // Creator-selected repositories replace the "own repos" rule.
      if (c.repo.id === undefined || !rules.repos.includes(c.repo.id)) { skip('other-repo'); continue; }
    } else {
      if (c.repo.fork && !allow.forks) { skip('fork'); continue; }
      if (c.repo.ownerId !== input.userGithubId) { skip('not-repo-owner'); continue; }
    }
    // Either git date older than the allowance: old work pushed late.
    const dated = [c.authoredAt, c.committedAt].filter((d): d is string => Boolean(d)).map((d) => Math.floor(Date.parse(d) / 1000));
    if (dated.some((s) => Number.isFinite(s) && s < backdateLimitSec)) { skip('backdated'); continue; }
    if (input.seen.shas.has(c.sha)) { skip('duplicate-sha'); continue; }

    const perFile: string[][] = [];
    let codeLines = 0;
    let docs = 0;
    let generated = 0;
    let eligibleFiles = 0;
    let cancelled = 0;
    let anyMatched = false;
    for (const f of c.files) {
      if (!matchesFilter(f.filename, rules.fileFilter)) continue;
      anyMatched = true;
      const kind = fileKind(f.filename);
      if (kind === 'docs') {
        if (!allow.docs) continue;
        const d = docLines(f.patch);
        docs += d.length;
        if (d.length) perFile.push(d.map((l) => `doc:${l}`));
        continue;
      }
      if (kind === 'generated') {
        if (!allow.generated || typeof f.patch !== 'string') continue;
        const g = f.patch.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++') && l.slice(1).trim()).length;
        generated += g;
        if (g) perFile.push([`gen:${f.filename}:${createHash('sha256').update(f.patch).digest('hex')}`]);
        continue;
      }
      if (kind !== 'code') continue;
      eligibleFiles++;
      const r = meaningfulAddedLines(f.patch);
      if (r.patchMissing) result.missingPatches++;
      cancelled += r.cancelled;
      if (r.lines.length > 0) {
        perFile.push(r.lines);
        codeLines += r.lines.length;
      }
    }

    if (!anyMatched && c.files.length > 0) { input.seen.shas.add(c.sha); skip('filtered-out'); continue; }
    if (codeLines + docs + generated === 0) {
      input.seen.shas.add(c.sha);
      skip(cancelled > 0 ? 'whitespace-only' : 'no-eligible-changes');
      continue;
    }

    const hash = diffHash(perFile);
    input.seen.shas.add(c.sha);
    if (input.seen.diffHashes.has(hash)) { skip('duplicate-diff'); continue; }
    input.seen.diffHashes.add(hash);

    if (codeLines > rules.bulkCommitLines || eligibleFiles > rules.bulkCommitFiles) {
      result.anomalies.push({ sha: c.sha, kind: 'bulk-commit', detail: `${codeLines} meaningful lines in ${eligibleFiles} eligible files` });
    }
    result.counted.push({ sha: c.sha, repo: c.repo.fullName, meaningfulLines: codeLines + docs + generated, diffHash: hash });
    result.breakdown.code += codeLines;
    result.breakdown.docs += docs;
    result.breakdown.generated += generated;
  }

  const b = result.breakdown;
  b.docsCredited = Math.min(b.docs, Math.floor(rules.minMeaningfulLines * GITHUB_OPTION_LIMITS.docsCapShare));
  b.generatedCredited = Math.min(b.generated, Math.floor(rules.minMeaningfulLines * GITHUB_OPTION_LIMITS.generatedCapShare));
  result.meaningfulLines = b.code + b.docsCredited + b.generatedCredited;
  result.meetsThreshold = result.meaningfulLines >= rules.minMeaningfulLines;
  return result;
}

export type GithubDayOutcome = 'verified' | 'failed' | 'indeterminate';

/**
 * The day's result. Below the goal is only a failure when the data was complete: if GitHub could
 * not be read fully (errors, rate limits, too many commits) or omitted diffs, the day is
 * indeterminate, which never forfeits a stake.
 */
export function githubDayOutcome(result: GithubDayResult, fetch: { complete: boolean }): GithubDayOutcome {
  if (result.meetsThreshold) return 'verified';
  if (!fetch.complete || result.missingPatches > 0) return 'indeterminate';
  return 'failed';
}

// ---------------------------------------------------------------- rules document

export interface GithubRulesDocument {
  minMeaningfulLines: number;
  ownNonForkReposOnly?: boolean;
  fileFilter?: { extensions?: string[]; filenames?: string[] } | null;
  allow?: Partial<GithubAllowances> | null;
  /** Creator-selected repositories (resolved and checked public when the challenge was created). */
  repos?: { id: number; fullName: string }[] | null;
}

/** Engine rules from a challenge's (hashed, immutable) rules document. Unknown fields stay strict. */
export function githubRulesFromDocument(doc: GithubRulesDocument): GithubRules {
  const allow = doc.allow ?? {};
  const filter = doc.fileFilter;
  return {
    ...DEFAULT_GITHUB_RULES,
    minMeaningfulLines: doc.minMeaningfulLines,
    fileFilter: filter && ((filter.extensions?.length ?? 0) > 0 || (filter.filenames?.length ?? 0) > 0)
      ? { extensions: filter.extensions ?? [], filenames: filter.filenames ?? [] }
      : null,
    repos: (doc.repos ?? []).map((r) => r.id).filter((id) => Number.isSafeInteger(id) && id > 0),
    allow: {
      docs: allow.docs === true,
      generated: allow.generated === true,
      forks: allow.forks === true && doc.ownNonForkReposOnly !== true,
      backdateHours: Math.min(Math.max(0, Math.trunc(allow.backdateHours ?? 0)), GITHUB_OPTION_LIMITS.maxBackdateHours),
    },
  };
}
