import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedRead, resetReadCache, throttled } from './read-cache';

describe('cachedRead', () => {
  beforeEach(() => resetReadCache());

  it('shares one request between concurrent readers and reuses it while fresh', async () => {
    let t = 0;
    const read = vi.fn(async () => 'v1');
    const [a, b] = await Promise.all([cachedRead('k', 1000, read, 60_000, () => t), cachedRead('k', 1000, read, 60_000, () => t)]);
    expect([a, b]).toEqual(['v1', 'v1']);
    t = 500;
    await cachedRead('k', 1000, read, 60_000, () => t);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('serves the last good value when the RPC fails (429), and errors when it has none', async () => {
    let t = 0;
    await cachedRead('k', 1000, async () => 'good', 60_000, () => t);
    t = 5000;
    await expect(cachedRead('k', 1000, async () => Promise.reject(new Error('429')), 60_000, () => t)).resolves.toBe('good');
    t = 120_000; // too old to serve
    await expect(cachedRead('k', 1000, async () => Promise.reject(new Error('429')), 60_000, () => t)).rejects.toThrow('429');
    await expect(cachedRead('other', 1000, async () => Promise.reject(new Error('down')), 60_000, () => t)).rejects.toThrow('down');
  });

  it('refreshes after the TTL', async () => {
    let t = 0;
    await cachedRead('k', 1000, async () => 'a', 60_000, () => t);
    t = 1500;
    expect(await cachedRead('k', 1000, async () => 'b', 60_000, () => t)).toBe('b');
  });
});

describe('throttled', () => {
  beforeEach(() => resetReadCache());
  it('runs at most once per interval per key', () => {
    let t = 0;
    const fn = vi.fn(async () => undefined);
    expect(throttled('s', 30_000, fn, () => t)).not.toBeNull();
    t = 10_000;
    expect(throttled('s', 30_000, fn, () => t)).toBeNull();
    t = 31_000;
    expect(throttled('s', 30_000, fn, () => t)).not.toBeNull();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
