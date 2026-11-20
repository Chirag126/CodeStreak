import { describe, expect, it } from 'vitest';
import { evaluateGithubDay, isEligibleFile, meaningfulAddedLines, type GithubCommit } from './github.js';

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
const run = (commits: GithubCommit[], seen = fresh()) => evaluateGithubDay({ commits, userGithubId: USER, window: DAY, seen });

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
