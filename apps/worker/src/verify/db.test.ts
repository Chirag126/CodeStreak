import { describe, expect, it, vi } from 'vitest';
import { Keypair } from '@codestreak/shared/program';
import { loadVerifier } from './chain.js';
import { createRestDb } from './db.js';

const noWait = { sleep: async () => {}, baseDelayMs: 1 };

describe('REST client', () => {
  it('retries a 503 from Supabase, then succeeds', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('{"message":"upstream down"}', { status: 503 }))
      .mockResolvedValueOnce(new Response('"run-1"', { status: 200 }));
    const db = createRestDb('https://x.supabase.co/', 'srk', fetchImpl as unknown as typeof fetch, noWait);
    await expect(db.rpc('begin_verification_run', { p_challenge: 'c' })).resolves.toBe('run-1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://x.supabase.co/rest/v1/rpc/begin_verification_run');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer srk');
  });

  it('does not retry a 4xx and reports its message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"message":"permission denied for function save_day_result"}', { status: 403 }));
    const db = createRestDb('https://x.supabase.co', 'srk', fetchImpl as unknown as typeof fetch, noWait);
    await expect(db.rpc('save_day_result')).rejects.toThrow('rpc save_day_result: HTTP 403 permission denied for function save_day_result');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('asks PostgREST to ignore duplicates on conflict', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    await createRestDb('https://x.supabase.co', 'k', fetchImpl as unknown as typeof fetch).insert('evidence', [{}], { onConflict: 'a,b', ignoreDuplicates: true });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://x.supabase.co/rest/v1/evidence?on_conflict=a,b');
    expect((init.headers as Record<string, string>).Prefer).toBe('return=minimal,resolution=ignore-duplicates');
  });
});

describe('loadVerifier', () => {
  it('is optional, and explains a malformed key', () => {
    expect(loadVerifier(undefined)).toBeNull();
    expect(() => loadVerifier('not json')).toThrow(/not valid JSON/);
    expect(() => loadVerifier('[1,2,3]')).toThrow(/64 numbers/);
  });
  it('rejects a key that is not VERIFIER_PUBKEY', () => {
    const k = Keypair.generate();
    const json = JSON.stringify(Array.from(k.secretKey));
    expect(loadVerifier(json, k.publicKey.toBase58())?.publicKey.toBase58()).toBe(k.publicKey.toBase58());
    expect(() => loadVerifier(json, '11111111111111111111111111111111')).toThrow(/not VERIFIER_PUBKEY/);
    const broken = Array.from(k.secretKey);
    broken[40] = (broken[40]! + 1) % 256;
    expect(() => loadVerifier(JSON.stringify(broken))).toThrow(/not a valid keypair/);
  });
});
