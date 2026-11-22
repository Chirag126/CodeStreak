import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GITHUB_RULES,
  evaluateGithubDay,
  fileKind,
  githubDayOutcome,
  githubRulesFromDocument,
  isEligibleFile,
  meaningfulAddedLines,
  type GithubCommit,
  type GithubRules,
} from './github.js';

const USER = 187127921;
const DAY = { startSec: Date.parse('2026-11-15T00:00:00Z') / 1000, endSec: Date.parse('2026-11-16T00:00:00Z') / 1000 };
const code = (n: number, tag = 'a') => Array.from({ length: n }, (_, i) => `+export const ${tag}${i} = compute(${i});`).join('\n');

const commit = (over: Partial<GithubCommit> & { sha: string }): GithubCommit => ({
  parentShas: ['p'],
  authorId: USER,
  pushedAt: '2026-11-15T06:12:13Z',
  repo: { fullName: 'Chirag126/SamiMeds', fork: false, ownerId: USER },
  files: [{ filename: 'src/app.ts', patch: code(20) }],
  ...over,
});

const fresh = () => ({ shas: new Set<string>(), diffHashes: new Set<string>() });
const run = (commits: GithubCommit[], seen = fresh(), rules?: GithubRules) => evaluateGithubDay({ commits, userGithubId: USER, window: DAY, seen, ...(rules ? { rules } : {}) });

describe('file and line rules', () => {
  it('eligible extensions and excluded paths', () => {
    expect(isEligibleFile('src/app/page.tsx')).toBe(true);
    expect(isEligibleFile('programs/codestreak/src/lib.rs')).toBe(true);
    expect(isEligibleFile('README.md')).toBe(false);
    expect(isEligibleFile('.env.example')).toBe(false);
    expect(isEligibleFile('pnpm-lock.yaml')).toBe(false);
    expect(isEligibleFile('dist/index.js')).toBe(false);
    expect(isEligibleFile('public/app.min.js')).toBe(false);
  });

  it('meaningful lines skip blanks, braces and comments but keep #include', () => {
    const patch = ['+const a = 1;', '+', '+}', '+// note', '+# python comment', '+#include <vector>', '+  return   a +  1;'].join('\n');
    expect(meaningfulAddedLines(patch).lines).toEqual(['const a = 1;', '#include <vector>', 'return a + 1;']);
  });

  it('generated files count zero and missing patches are reported', () => {
    expect(meaningfulAddedLines('+// @generated\n+const x = 1;').lines).toEqual([]);
    expect(meaningfulAddedLines(undefined).patchMissing).toBe(true);
  });
});

describe('day evaluation', () => {
  it('credits a normal commit and meets the threshold', () => {
    const r = run([commit({ sha: 'c1' })]);
    expect(r.meaningfulLines).toBe(20);
    expect(r.meetsThreshold).toBe(true);
  });

  it('PHASE 2 FINDING: merge commits never count (9837688 repeated aa3e99b)', () => {
    const r = run([commit({ sha: 'aa3e99b' }), commit({ sha: '9837688', parentShas: ['aa3e99b', 'main'] })]);
    expect(r.counted.map((c) => c.sha)).toEqual(['aa3e99b']);
    expect(r.skipped).toContainEqual({ sha: '9837688', repo: 'Chirag126/SamiMeds', reason: 'merge-commit' });
  });

  it('PHASE 2 FINDING: the same SHA in two pushes counts once', () => {
    const seen = fresh();
    run([commit({ sha: 'aa3e99b', pushedAt: '2026-11-15T06:04:40Z' })], seen);
    const second = run([commit({ sha: 'aa3e99b', pushedAt: '2026-11-15T06:12:13Z' })], seen);
    expect(second.meaningfulLines).toBe(0);
    expect(second.skipped[0]?.reason).toBe('duplicate-sha');
  });

  it('PHASE 2 FINDING: identical changes under different SHAs count once (3d62092 vs c298ba3)', () => {
    const r = run([
      commit({ sha: '3d62092', pushedAt: '2026-11-15T06:04:00Z' }),
      commit({ sha: 'c298ba3', pushedAt: '2026-11-15T06:05:00Z', files: [{ filename: 'other/path.ts', patch: code(20) }] }),
    ]);
    expect(r.counted.map((c) => c.sha)).toEqual(['3d62092']);
    expect(r.skipped).toContainEqual({ sha: 'c298ba3', repo: 'Chirag126/SamiMeds', reason: 'duplicate-diff' });
  });

  it('PHASE 2 FINDING: commits from an email not linked to the user do not count', () => {
    const r = run([commit({ sha: '695c738', authorId: null })]);
    expect(r.skipped[0]?.reason).toBe('author-mismatch');
    expect(r.meetsThreshold).toBe(false);
  });

  it('backdated commits are judged by push time, not author date', () => {
    expect(run([commit({ sha: 'late', pushedAt: '2026-11-16T00:00:01Z' })]).skipped[0]?.reason).toBe('outside-day');
    expect(run([commit({ sha: 'edge', pushedAt: '2026-11-15T23:59:59Z' })]).meaningfulLines).toBe(20);
  });

  it('forks and other owners do not count', () => {
    expect(run([commit({ sha: 'f', repo: { fullName: 'x/fork', fork: true, ownerId: USER } })]).skipped[0]?.reason).toBe('fork');
    expect(run([commit({ sha: 'o', repo: { fullName: 'org/repo', fork: false, ownerId: 1 } })]).skipped[0]?.reason).toBe('not-repo-owner');
  });

  it('README / config-only commits do not count', () => {
    const r = run([commit({ sha: 'docs', files: [{ filename: 'README.md', patch: '+hello' }, { filename: '.gitignore', patch: '+dist' }] })]);
    expect(r.skipped[0]?.reason).toBe('no-eligible-changes');
  });

  it('bulk commits are flagged as anomalies but still counted', () => {
    const r = run([commit({ sha: 'bulk', files: [{ filename: 'src/big.ts', patch: code(500, 'b') }] })]);
    expect(r.meaningfulLines).toBe(500);
    expect(r.anomalies).toHaveLength(1);
    expect(r.anomalies[0]?.kind).toBe('bulk-commit');
  });

  it('below threshold does not qualify', () => {
    const r = run([commit({ sha: 'small', files: [{ filename: 'src/a.ts', patch: code(5) }] })]);
    expect(r.meaningfulLines).toBe(5);
    expect(r.meetsThreshold).toBe(false);
  });
});

// ---------------------------------------------------------------- Phase 24 fixtures

const reindent = (n: number) =>
  Array.from({ length: n }, (_, i) => `-export const a${i} = compute(${i});\n+    export const a${i} =   compute(${i});`).join('\n');
const rules = (over: Partial<GithubRules> = {}, allow: Partial<NonNullable<GithubRules['allow']>> = {}): GithubRules => ({
  ...DEFAULT_GITHUB_RULES,
  ...over,
  allow: { docs: false, generated: false, forks: false, backdateHours: 0, ...allow },
});

describe('Phase 24 fixtures: not counted by default', () => {
  it('whitespace-only (re-indented / reformatted) changes count zero', () => {
    const r = run([commit({ sha: 'ws', files: [{ filename: 'src/app.ts', patch: reindent(30) }] })]);
    expect(r.meaningfulLines).toBe(0);
    expect(r.skipped[0]?.reason).toBe('whitespace-only');
  });

  it('moved lines count zero, but genuinely new lines in the same file count', () => {
    const patch = `${reindent(10)}\n${code(16, 'n')}`;
    expect(run([commit({ sha: 'mv', files: [{ filename: 'src/app.ts', patch }] })]).meaningfulLines).toBe(16);
  });

  it('lockfiles count zero', () => {
    for (const filename of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'Cargo.lock', 'poetry.lock', 'uv.lock']) {
      expect(fileKind(filename)).toBe('generated');
      expect(run([commit({ sha: filename, files: [{ filename, patch: code(40) }] })]).meaningfulLines).toBe(0);
    }
  });

  it('README and docs count zero', () => {
    const r = run([commit({ sha: 'doc', files: [{ filename: 'README.md', patch: '+# Title\n+Some long explanation of the project goes here.\n'.repeat(10) }] })]);
    expect(r.meaningfulLines).toBe(0);
  });

  it('minified files count zero, by name or by very long lines', () => {
    expect(run([commit({ sha: 'min1', files: [{ filename: 'public/app.min.js', patch: code(40) }] })]).meaningfulLines).toBe(0);
    const longLine = `+${'var a=1;'.repeat(80)}`;
    expect(run([commit({ sha: 'min2', files: [{ filename: 'src/vendor-lib.js', patch: `${longLine}\n${code(20)}` }] })]).meaningfulLines).toBe(0);
  });

  it('forks count zero', () => {
    const r = run([commit({ sha: 'fork', repo: { fullName: 'Chirag126/next.js', fork: true, ownerId: USER } })]);
    expect(r.skipped[0]?.reason).toBe('fork');
  });

  it('backdated commits (old work pushed today) count zero', () => {
    const r = run([commit({ sha: 'old', authoredAt: '2026-11-10T09:00:00Z', committedAt: '2026-11-10T09:00:00Z' })]);
    expect(r.skipped[0]?.reason).toBe('backdated');
    // A commit made during the day still counts.
    expect(run([commit({ sha: 'new', authoredAt: '2026-11-15T05:00:00Z', committedAt: '2026-11-15T05:30:00Z' })]).meetsThreshold).toBe(true);
  });

  it('rebase duplicates count once (new SHA, same change, later push)', () => {
    const seen = fresh();
    const first = run([commit({ sha: 'orig', pushedAt: '2026-11-15T06:00:00Z' })], seen);
    const rebased = run([commit({ sha: 'rebased', pushedAt: '2026-11-15T09:00:00Z' })], seen);
    expect(first.meaningfulLines).toBe(20);
    expect(rebased.skipped[0]?.reason).toBe('duplicate-diff');
  });
});

describe('Phase 24: creator options, with limits', () => {
  it('docs count when allowed, capped at half the goal', () => {
    const readme = { filename: 'README.md', patch: Array.from({ length: 30 }, (_, i) => `+Line ${i} of real documentation.`).join('\n') };
    const r = run([commit({ sha: 'doc', files: [readme] })], fresh(), rules({}, { docs: true }));
    expect(r.breakdown.docs).toBe(30);
    expect(r.breakdown.docsCredited).toBe(7); // floor(15 * 0.5)
    expect(r.meetsThreshold).toBe(false); // docs alone can never complete a day
  });

  it('generated files count when allowed, capped at a quarter of the goal', () => {
    const r = run([commit({ sha: 'lock', files: [{ filename: 'package-lock.json', patch: code(200) }, { filename: 'src/a.ts', patch: code(12) }] })], fresh(), rules({}, { generated: true }));
    expect(r.breakdown.generatedCredited).toBe(3); // floor(15 * 0.25)
    expect(r.meaningfulLines).toBe(15);
    expect(r.meetsThreshold).toBe(true);
  });

  it('forks count when allowed (own commits, own fork only)', () => {
    const own = commit({ sha: 'f1', repo: { fullName: 'Chirag126/next.js', fork: true, ownerId: USER } });
    expect(run([own], fresh(), rules({}, { forks: true })).meetsThreshold).toBe(true);
    const someoneElses = commit({ sha: 'f2', repo: { fullName: 'other/next.js', fork: true, ownerId: 42 } });
    expect(run([someoneElses], fresh(), rules({}, { forks: true })).skipped[0]?.reason).toBe('not-repo-owner');
  });

  it('backdated commits count within the allowance only, which is capped at 72 hours', () => {
    const lateNight = commit({ sha: 'ln', authoredAt: '2026-11-14T22:00:00Z', committedAt: '2026-11-14T22:00:00Z' });
    expect(run([lateNight], fresh(), rules({}, { backdateHours: 4 })).meetsThreshold).toBe(true);
    expect(run([lateNight], fresh(), rules({}, { backdateHours: 1 })).skipped[0]?.reason).toBe('backdated');
    const weekOld = commit({ sha: 'wk', authoredAt: '2026-11-08T12:00:00Z' });
    expect(run([weekOld], fresh(), rules({}, { backdateHours: 500 })).skipped[0]?.reason).toBe('backdated');
  });

  it('whitespace-only and rebase duplicates stay excluded with every option on', () => {
    const all = rules({}, { docs: true, generated: true, forks: true, backdateHours: 72 });
    expect(run([commit({ sha: 'ws', files: [{ filename: 'src/app.ts', patch: reindent(30) }] })], fresh(), all).meaningfulLines).toBe(0);
    const seen = fresh();
    run([commit({ sha: 'a' })], seen, all);
    expect(run([commit({ sha: 'b', pushedAt: '2026-11-15T08:00:00Z' })], seen, all).skipped[0]?.reason).toBe('duplicate-diff');
  });

  it('file filter: extensions and exact file names', () => {
    const files = [
      { filename: 'src/app.ts', patch: code(10, 'ts') },
      { filename: 'tools/main.py', patch: code(10, 'py') },
      { filename: 'lib/util.go', patch: code(10, 'go') },
    ];
    expect(run([commit({ sha: 'x1', files })], fresh(), rules({ fileFilter: { extensions: ['.ts'], filenames: [] } })).meaningfulLines).toBe(10);
    expect(run([commit({ sha: 'x2', files })], fresh(), rules({ fileFilter: { extensions: [], filenames: ['main.py'] } })).meaningfulLines).toBe(10);
    expect(run([commit({ sha: 'x3', files })], fresh(), rules({ fileFilter: { extensions: ['.ts'], filenames: ['MAIN.PY'] } })).meaningfulLines).toBe(20);
    expect(run([commit({ sha: 'x4', files })], fresh(), rules({ fileFilter: { extensions: ['.rs'], filenames: [] } })).skipped[0]?.reason).toBe('filtered-out');
  });

  it('builds engine rules from a rules document, staying strict for anything missing or out of range', () => {
    expect(githubRulesFromDocument({ minMeaningfulLines: 20, ownNonForkReposOnly: true })).toMatchObject({
      minMeaningfulLines: 20,
      fileFilter: null,
      allow: { docs: false, generated: false, forks: false, backdateHours: 0 },
    });
    expect(githubRulesFromDocument({ minMeaningfulLines: 20, ownNonForkReposOnly: false, allow: { forks: true, backdateHours: 999 }, fileFilter: { extensions: ['.ts'] } })).toMatchObject({
      fileFilter: { extensions: ['.ts'], filenames: [] },
      allow: { forks: true, backdateHours: 72 },
    });
  });
});

describe('Phase 24: day result', () => {
  it('verified, failed, or indeterminate when GitHub data was incomplete', () => {
    const ok = run([commit({ sha: 'ok' })]);
    expect(githubDayOutcome(ok, { complete: true })).toBe('verified');
    const none = run([]);
    expect(githubDayOutcome(none, { complete: true })).toBe('failed');
    expect(githubDayOutcome(none, { complete: false })).toBe('indeterminate');
    const missing = run([commit({ sha: 'big', files: [{ filename: 'src/huge.ts' }] })]);
    expect(githubDayOutcome(missing, { complete: true })).toBe('indeterminate');
  });
});
