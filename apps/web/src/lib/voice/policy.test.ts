import { describe, expect, it } from 'vitest';
import { announcementText, clipHash, clipPath } from './policy';

describe('voice policy', () => {
  it('hashes voice, model and text together', () => {
    const a = clipHash('v1', 'm1', 'hello');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(clipHash('v1', 'm1', 'hello')).toBe(a);
    expect(clipHash('v2', 'm1', 'hello')).not.toBe(a);
    expect(clipHash('v1', 'm2', 'hello')).not.toBe(a);
    expect(clipHash('v1', 'm1', 'hello!')).not.toBe(a);
    expect(clipPath(a)).toBe(`clips/${a.slice(0, 2)}/${a}.mp3`);
  });

  it('turns a notification into short speech without links or addresses', () => {
    const t = announcementText({
      title: 'Day 2 verified · Alerts group',
      body: 'See https://codestreak.dev/challenges/4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T for details',
    });
    expect(t).toBe('Day 2 verified, Alerts group. See for details');
    expect(announcementText({ title: 'Your reward of 0.02 SOL arrived', body: '' })).toBe('Your reward of 0.02 SOL arrived.');
  });
});
