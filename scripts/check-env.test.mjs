// Tests for the environment validator. Fake values are assembled at runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEnv, parseDotenv, isPubkey } from './check-env.mjs';

const jwt = (role) => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ role })}.${'s'.repeat(43)}`;
};

const validPhase1 = () => ({
  SOLANA_CLUSTER: 'devnet',
  SOLANA_RPC_URL: 'https://devnet.helius-rpc.com/?api-key=' + '0'.repeat(8) + '-0000-0000-0000-' + '0'.repeat(12),
  NEXT_PUBLIC_SOLANA_CLUSTER: 'devnet',
  NEXT_PUBLIC_SOLANA_RPC_URL: 'https://api.devnet.solana.com',
  NEXT_PUBLIC_USDC_MINT: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  NEXT_PUBLIC_WSOL_MINT: 'So11111111111111111111111111111111111111112',
  UPGRADE_AUTHORITY_PUBKEY: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  RELAYER_PUBKEY: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  VERIFIER_PUBKEY: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  ADMIN_PUBKEY: 'SysvarC1ock11111111111111111111111111111111',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb' + '_publishable_' + 'p'.repeat(24),
  SUPABASE_SERVICE_ROLE_KEY: 'sb' + '_secret_' + 'q'.repeat(24),
  GITHUB_API_TOKEN: 'github' + '_pat_' + 'A1b2C3d4'.repeat(8),
  FIRECRAWL_API_KEY: 'fc' + '-' + 'a1'.repeat(16),
  APP_URL: 'http://localhost:3000',
});

const statusOf = (rows, name) => rows.filter((r) => r.name === name).map((r) => r.status);

test('a complete Phase 1 env passes; later-phase variables are LATER, not errors', () => {
  const { errors, rows } = validateEnv(validPhase1(), 1);
  assert.equal(errors, 0, JSON.stringify(rows.filter((r) => r.status === 'INVALID' || r.status === 'MISSING')));
  assert.deepEqual(statusOf(rows, 'ELEVENLABS_API_KEY'), ['LATER']);
  assert.deepEqual(statusOf(rows, 'NEXT_PUBLIC_CODESTREAK_PROGRAM_ID'), ['LATER']);
});

test('missing required values fail', () => {
  const env = validPhase1();
  delete env.FIRECRAWL_API_KEY;
  const { errors, rows } = validateEnv(env, 1);
  assert.equal(errors, 1);
  assert.deepEqual(statusOf(rows, 'FIRECRAWL_API_KEY'), ['MISSING']);
});

test('mainnet is rejected', () => {
  const env = { ...validPhase1(), SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com', SOLANA_CLUSTER: 'mainnet-beta' };
  const { rows } = validateEnv(env, 1);
  assert.deepEqual(statusOf(rows, 'SOLANA_RPC_URL'), ['INVALID']);
  assert.deepEqual(statusOf(rows, 'SOLANA_CLUSTER'), ['INVALID']);
});

test('service role key in a public variable is rejected', () => {
  const env = { ...validPhase1(), NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt('service_role') };
  const { rows } = validateEnv(env, 1);
  assert.ok(statusOf(rows, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY').includes('INVALID'));
});

test('any secret pattern in NEXT_PUBLIC_* is rejected', () => {
  const env = { ...validPhase1(), NEXT_PUBLIC_DEBUG: 'gh' + 'p_' + 'x'.repeat(36) };
  const { rows } = validateEnv(env, 1);
  assert.ok(statusOf(rows, 'NEXT_PUBLIC_DEBUG').includes('INVALID'));
});

test('operator keys must be distinct', () => {
  const env = { ...validPhase1() };
  env.VERIFIER_PUBKEY = env.RELAYER_PUBKEY;
  const { rows } = validateEnv(env, 1);
  assert.ok(statusOf(rows, 'VERIFIER_PUBKEY').includes('INVALID'));
});

test('legacy anon JWT is accepted as publishable key', () => {
  const env = { ...validPhase1(), NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt('anon') };
  const { errors } = validateEnv(env, 1);
  assert.equal(errors, 0);
});

test('inline keypair JSON (Render style) is accepted for later phases', () => {
  const env = { ...validPhase1(), RELAYER_KEYPAIR_JSON: JSON.stringify(Array.from({ length: 64 }, () => 1)) };
  const { rows } = validateEnv(env, 15);
  assert.deepEqual(statusOf(rows, 'RELAYER_KEYPAIR_PATH'), ['OK']);
});

test('pubkey validation', () => {
  assert.ok(isPubkey('11111111111111111111111111111111'));
  assert.ok(isPubkey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'));
  assert.ok(!isPubkey('0x52908400098527886E0F7030069857D2E4169EE7'));
  assert.ok(!isPubkey('not-a-key'));
});

test('dotenv parsing handles quotes, comments and export', () => {
  const env = parseDotenv('# c\nA=1\nexport B="two words"\nC=three # note\nD=\n');
  assert.deepEqual(env, { A: '1', B: 'two words', C: 'three', D: '' });
});
