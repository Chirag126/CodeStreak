import { describe, expect, it } from 'vitest';
import { initialLive, liveReducer, retryDelayMs, type LiveEvent } from './live';

const run = (...events: LiveEvent['type'][]) => events.reduce((s, type) => liveReducer(s, { type } as LiveEvent), initialLive);

describe('live board connection', () => {
  it('goes live on subscribe with nothing missed', () => {
    expect(run('SUBSCRIBED')).toEqual({ status: 'live', attempt: 0, missedChanges: false });
  });

  it('reconnects after going offline and must re-fetch what it missed', () => {
    const back = run('SUBSCRIBED', 'OFFLINE', 'CLOSED', 'ONLINE', 'SUBSCRIBED');
    expect(back.status).toBe('live');
    expect(back.missedChanges).toBe(true);
    expect(liveReducer(back, { type: 'CAUGHT_UP' }).missedChanges).toBe(false);
  });

  it('stays offline (no retry storm) until the browser is back online', () => {
    expect(run('SUBSCRIBED', 'OFFLINE', 'CHANNEL_ERROR', 'TIMED_OUT').status).toBe('offline');
    expect(run('SUBSCRIBED', 'OFFLINE', 'ONLINE').status).toBe('reconnecting');
  });

  it('backs off on repeated channel errors, and resets once live', () => {
    const s = run('CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED');
    expect(s).toMatchObject({ status: 'reconnecting', attempt: 3, missedChanges: true });
    expect([1, 2, 3, 4, 10].map(retryDelayMs)).toEqual([1000, 2000, 4000, 8000, 30000]);
    expect(liveReducer(s, { type: 'SUBSCRIBED' }).attempt).toBe(0);
  });
});
