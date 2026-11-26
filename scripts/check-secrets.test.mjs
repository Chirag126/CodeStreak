// Tests for the secret scanner and the pre-commit hook.
// Fake secrets are assembled at runtime so this file never contains a literal secret.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { scanText, scanFile, checkFilename } from './check-secrets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

const fake = {
  keypairArray: () => `[${Array.from({ length: 64 }, (_, i) => (i * 7) % 256).join(',')}]`,
  githubPat: () => 'github' + '_pat_' + 'A1b2C3d4'.repeat(8),
  ghp: () => 'gh' + 'p_' + 'x'.repeat(36),
  supabaseSecret: () => 'sb' + '_secret_' + 'q'.repeat(24),
  jwt: (role) => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role, exp: 9999999999 })}.${'s'.repeat(43)}`;
  },
  firecrawl: () => 'fc' + '-' + 'a1'.repeat(16),
  skKey: () => 'sk' + '_' + 'f0'.repeat(24),
  base58Secret: () => '5'.repeat(1) + 'K'.repeat(87),
  pem: () => '-----BEGIN ' + 'PRIVATE KEY-----',
};

const rulesOf = (findings) => findings.map((f) => f.rule);

test('detects a Solana keypair array', () => {
  assert.ok(rulesOf(scanText('a.ts', `const k = ${fake.keypairArray()};`)).includes('solana-keypair-array'));
});

test('detects GitHub tokens', () => {
  assert.ok(rulesOf(scanText('a.ts', fake.githubPat())).includes('github-fine-grained-pat'));
  assert.ok(rulesOf(scanText('a.ts', fake.ghp())).includes('github-token'));
});

test('detects Supabase secret key and service_role JWT, but allows anon JWT', () => {
  assert.ok(rulesOf(scanText('a.ts', fake.supabaseSecret())).includes('supabase-secret-key'));
  assert.ok(rulesOf(scanText('a.ts', fake.jwt('service_role'))).includes('supabase-service-role-jwt'));
  assert.deepEqual(scanText('a.ts', fake.jwt('anon')), []);
});

test('detects Firecrawl, sk_ keys, PEM blocks and base58 secret keys', () => {
  assert.ok(rulesOf(scanText('a.ts', fake.firecrawl())).includes('firecrawl-api-key'));
  assert.ok(rulesOf(scanText('a.ts', fake.skKey())).includes('sk-style-api-key'));
  assert.ok(rulesOf(scanText('a.ts', fake.pem())).includes('pem-private-key'));
  assert.ok(rulesOf(scanText('a.ts', `const s = "${fake.base58Secret()}"`)).includes('base58-secret-key'));
});

test('does not flag explorer transaction links or public keys', () => {
  const sig = '5'.repeat(1) + 'K'.repeat(87);
  assert.deepEqual(scanText('a.md', `https://explorer.solana.com/tx/${sig}?cluster=devnet`), []);
  assert.deepEqual(scanText('a.ts', 'const mint = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";'), []);
});

test('respects the allow marker', () => {
  assert.deepEqual(scanText('a.ts', `${fake.ghp()} // secret-scan:allow`), []);
});

test('.env.example must not contain secret values', () => {
  const findings = scanText('.env.example', `FIRECRAWL_API_KEY=abc\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=pub\nSOLANA_CLUSTER=devnet\n`);
  assert.deepEqual(rulesOf(findings), ['env-example-secret-value']);
});

test('the real .env.example is clean', () => {
  const findings = scanFile('.env.example', readFileSync(path.join(repoRoot, '.env.example')));
  assert.deepEqual(findings, []);
});

test('forbidden filenames', () => {
  assert.ok(checkFilename('.env'));
  assert.ok(checkFilename('apps/web/.env.local'));
  assert.equal(checkFilename('.env.example'), null);
  assert.ok(checkFilename('relayer-keypair.json'));
  assert.ok(checkFilename('id.json'));
  assert.ok(checkFilename('keys/verifier.json'));
  assert.ok(checkFilename('certs/server.pem'));
  assert.equal(checkFilename('package.json'), null);
});

test('pre-commit hook blocks a commit containing a fake key, and allows a clean one', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'codestreak-hook-'));
  try {
    const run = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    run(['init', '-q']);
    run(['config', 'user.name', 'test']);
    run(['config', 'user.email', 'test@example.com']);
    mkdirSync(path.join(dir, 'scripts'));
    mkdirSync(path.join(dir, '.githooks'));
    copyFileSync(path.join(here, 'check-secrets.mjs'), path.join(dir, 'scripts', 'check-secrets.mjs'));
    copyFileSync(path.join(repoRoot, '.githooks', 'pre-commit'), path.join(dir, '.githooks', 'pre-commit'));
    chmodSync(path.join(dir, '.githooks', 'pre-commit'), 0o755);
    run(['config', 'core.hooksPath', '.githooks']);

    writeFileSync(path.join(dir, 'leak.ts'), `export const token = "${fake.githubPat()}";\n`);
    run(['add', '.']);
    const blocked = run(['commit', '-q', '-m', 'leak']);
    assert.notEqual(blocked.status, 0, 'commit with a secret must fail');
    assert.match(blocked.stderr, /Commit blocked/);

    writeFileSync(path.join(dir, 'leak.ts'), 'export const token = process.env.GITHUB_API_TOKEN;\n');
    run(['add', '.']);
    const ok = run(['commit', '-q', '-m', 'clean']);
    assert.equal(ok.status, 0, `clean commit must pass: ${ok.stderr}`);

    writeFileSync(path.join(dir, '.env.local'), 'SOLANA_CLUSTER=devnet\n');
    run(['add', '-f', '.env.local']);
    const envBlocked = run(['commit', '-q', '-m', 'env']);
    assert.notEqual(envBlocked.status, 0, 'committing .env.local must fail');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--history finds a secret that was committed and later deleted', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cs-history-'));
  try {
    const run = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
    run(['init', '-q']);
    run(['config', 'user.name', 'test']);
    run(['config', 'user.email', 'test@example.com']);
    const scanner = path.join(here, 'check-secrets.mjs');
    const scan = () => spawnSync(process.execPath, [scanner, '--history'], { cwd: dir, encoding: 'utf8' });

    writeFileSync(path.join(dir, 'ok.ts'), 'export const x = 1;\n');
    run(['add', '.']);
    run(['commit', '-q', '-m', 'clean']);
    assert.equal(scan().status, 0, 'clean history passes');

    writeFileSync(path.join(dir, 'leak.ts'), `export const token = "${fake.githubPat()}";\n`);
    run(['add', '.']);
    run(['commit', '-q', '--no-verify', '-m', 'leak']);
    run(['rm', '-q', 'leak.ts']);
    run(['commit', '-q', '--no-verify', '-m', 'remove leak']);
    const found = scan();
    assert.equal(found.status, 1, 'a deleted secret is still in history');
    assert.match(found.stderr, /leak\.ts/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
