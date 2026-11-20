import { describe, expect, it } from 'vitest';
import { EnvError, jwtRole, parseEnv, publicEnvSchema, workerEnvSchema } from './env.js';

const jwt = (role: string) => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64({ role })}.${'s'.repeat(43)}`;
};

const publicOk = {
  NEXT_PUBLIC_SOLANA_CLUSTER: 'devnet',
  NEXT_PUBLIC_SOLANA_RPC_URL: 'https://api.devnet.solana.com',
  NEXT_PUBLIC_USDC_MINT: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  NEXT_PUBLIC_WSOL_MINT: 'So11111111111111111111111111111111111111112',
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnop.supabase.co',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb' + '_publishable_' + 'p'.repeat(24),
};

const problemsOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    if (e instanceof EnvError) return e.problems;
    throw e;
  }
  return [];
};

describe('env validation', () => {
  it('accepts a valid public env; program id is optional until Phase 9', () => {
    const env = parseEnv(publicEnvSchema, publicOk, 'public');
    expect(env.NEXT_PUBLIC_SOLANA_CLUSTER).toBe('devnet');
    expect(env.NEXT_PUBLIC_CODESTREAK_PROGRAM_ID).toBeUndefined();
  });

  it('treats empty strings as unset', () => {
    const env = parseEnv(publicEnvSchema, { ...publicOk, NEXT_PUBLIC_CODESTREAK_PROGRAM_ID: '' }, 'public');
    expect(env.NEXT_PUBLIC_CODESTREAK_PROGRAM_ID).toBeUndefined();
  });

  it('rejects mainnet', () => {
    const p = problemsOf(() => parseEnv(publicEnvSchema, { ...publicOk, NEXT_PUBLIC_SOLANA_CLUSTER: 'mainnet-beta', NEXT_PUBLIC_SOLANA_RPC_URL: 'https://api.mainnet-beta.solana.com' }, 'public'));
    expect(p.some((x) => x.startsWith('NEXT_PUBLIC_SOLANA_CLUSTER'))).toBe(true);
    expect(p.some((x) => x.startsWith('NEXT_PUBLIC_SOLANA_RPC_URL'))).toBe(true);
  });

  it('rejects secrets in public variables and never prints values', () => {
    const secret = 'sb' + '_secret_' + 'q'.repeat(24);
    const p = problemsOf(() => parseEnv(publicEnvSchema, { ...publicOk, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret }, 'public'));
    expect(p.length).toBeGreaterThan(0);
    expect(p.join('\n')).not.toContain(secret);
    expect(problemsOf(() => parseEnv(publicEnvSchema, { ...publicOk, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt('service_role') }, 'public')).length).toBeGreaterThan(0);
    expect(problemsOf(() => parseEnv(publicEnvSchema, { ...publicOk, NEXT_PUBLIC_DEBUG: 'gh' + 'p_' + 'x'.repeat(36) }, 'public')).length).toBeGreaterThan(0);
  });

  it('accepts the legacy anon JWT as publishable key', () => {
    expect(() => parseEnv(publicEnvSchema, { ...publicOk, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: jwt('anon') }, 'public')).not.toThrow();
    expect(jwtRole(jwt('anon'))).toBe('anon');
    expect(jwtRole('not-a-jwt')).toBeNull();
  });

  it('worker env: requires a long job secret, defaults PORT to 10000', () => {
    const base = { SOLANA_CLUSTER: 'devnet', SOLANA_RPC_URL: 'https://api.devnet.solana.com' };
    expect(problemsOf(() => parseEnv(workerEnvSchema, { ...base, WORKER_JOB_SECRET: 'short' }, 'worker'))[0]).toMatch(/^WORKER_JOB_SECRET/);
    const env = parseEnv(workerEnvSchema, { ...base, WORKER_JOB_SECRET: 'x'.repeat(64) }, 'worker');
    expect(env.PORT).toBe(10000);
  });
});
