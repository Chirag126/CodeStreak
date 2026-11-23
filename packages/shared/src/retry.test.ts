import { describe, expect, it } from 'vitest';
import { isTransientError, withRetry } from './retry.js';

const noSleep = async () => {};

describe('withRetry', () => {
  it('retries transient failures with doubling delays, then succeeds', async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error('429 Too Many Requests');
        return 'ok';
      },
      { sleep: noSleep, onRetry: (_a, _e, d) => delays.push(d) },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(delays).toEqual([500, 1000]);
  });

  it('gives up after the last attempt with the real error', async () => {
    let calls = 0;
    await expect(withRetry(async () => { calls++; throw new Error('fetch failed'); }, { attempts: 3, sleep: noSleep })).rejects.toThrow('fetch failed');
    expect(calls).toBe(3);
  });

  it('never retries a program error', async () => {
    let calls = 0;
    await expect(
      withRetry(async () => { calls++; throw new Error('AnchorError: Error Code: VerifiedIsFinal. 503'); }, { sleep: noSleep }),
    ).rejects.toThrow('VerifiedIsFinal');
    expect(calls).toBe(1);
  });
});

describe('isTransientError', () => {
  it('classifies RPC failures', () => {
    expect(isTransientError(new Error('failed to get recent blockhash: Blockhash not found'))).toBe(true);
    expect(isTransientError(new Error('Server responded with 503 Service Unavailable'))).toBe(true);
    expect(isTransientError(new Error('Transaction simulation failed: custom program error: 0x1772'))).toBe(false);
    expect(isTransientError(new Error('Invalid public key input'))).toBe(false);
  });
});
