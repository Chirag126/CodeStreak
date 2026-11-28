import { describe, expect, it } from 'vitest';
import { BRIEFING_MAX_CHARS, composeBriefing, speakable, spokenDuration, type BriefingChallenge, type BriefingInput } from './briefing.js';

const running = (over: Partial<BriefingChallenge> = {}): BriefingChallenge => ({
  title: 'Daily grind',
  href: '/challenges/Abc',
  phase: 'running',
  day: 2,
  numDays: 7,
  secsLeft: 2 * 3600 + 14 * 60 + 10,
  today: 'not_checked',
  providers: ['github'],
  providerRule: 'any',
  rank: { position: 2, of: 5 },
  ...over,
});

const input = (over: Partial<BriefingInput> = {}): BriefingInput => ({
  streak: { current: 8, longest: 12 },
  challenges: [running()],
  claimable: [],
  unread: { count: 0, latest: null },
  linked: { github: true, leetcode: false, wallet: true },
  ...over,
});

describe('spokenDuration', () => {
  it('rounds to speakable, stable buckets', () => {
    expect(spokenDuration(20)).toBe('less than a minute');
    expect(spokenDuration(61)).toBe('1 minute');
    expect(spokenDuration(7 * 60 + 40)).toBe('8 minutes');
    expect(spokenDuration(27 * 60)).toBe('25 minutes');
    expect(spokenDuration(2 * 3600 + 14 * 60)).toBe('2 hours and 15 minutes');
    expect(spokenDuration(3 * 3600 + 1)).toBe('3 hours');
    expect(spokenDuration(20 * 3600)).toBe('20 hours');
    expect(spokenDuration(5 * 86400)).toBe('5 days');
  });

  it('gives the same text for presses a minute apart (so the audio cache hits)', () => {
    expect(spokenDuration(2 * 3600 + 14 * 60)).toBe(spokenDuration(2 * 3600 + 13 * 60));
  });
});

describe('speakable', () => {
  it('removes links, addresses, emails and long numbers', () => {
    const s = speakable('Join https://x.dev/a at 4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T or me@mail.com 123456789012', 200);
    expect(s).not.toMatch(/https|4Nd1m|@|123456789012/);
  });
  it('trims on a word boundary', () => {
    expect(speakable('one two three four five six', 12)).toBe('one two…');
  });
});

describe('composeBriefing', () => {
  it('states time left, today, streak, rank and the next action from the facts only', () => {
    const b = composeBriefing(input());
    expect(b.text).toContain("you're on day 3 of 7, and it ends in 2 hours and 15 minutes");
    expect(b.text).toContain("Today isn't verified yet.");
    expect(b.text).toContain('Your current streak is 8 days, and your best is 12.');
    expect(b.text).toContain("You're second of 5 in this group.");
    expect(b.next).toEqual({ label: 'Finish today: push your code to GitHub, then press Check now', href: '/challenges/Abc', urgent: true });
  });

  it('never invents a rank or claims it does not have', () => {
    const b = composeBriefing(input({ challenges: [running({ rank: null })], claimable: null }));
    expect(b.text).not.toMatch(/in this group|claim/i);
  });

  it('prioritises the challenge that still needs work and mentions the others briefly', () => {
    const b = composeBriefing(
      input({ challenges: [running({ title: 'Done one', today: 'verified', secsLeft: 600 }), running({ title: 'Needs work', today: 'behind', providers: ['leetcode'] })] }),
    );
    expect(b.paragraphs[0]).toContain('In Needs work');
    expect(b.text).toContain('Done one, day 3 of 7, is in good shape today, with 10 minutes left.');
    expect(b.next.label).toContain('solve your LeetCode problems');
  });

  it('points to claims when nothing is urgent and money is waiting', () => {
    const b = composeBriefing(input({ challenges: [running({ today: 'verified' })], claimable: ['0.02 SOL', '1 USDC'] }));
    expect(b.text).toContain('You have money ready to claim: 0.02 SOL and 1 USDC.');
    expect(b.next).toMatchObject({ href: '/dashboard/claims', urgent: false });
  });

  it('handles a player with no challenge and no linked account', () => {
    const b = composeBriefing(input({ challenges: [], streak: { current: 0, longest: 0 }, linked: { github: false, leetcode: false, wallet: false } }));
    expect(b.text).toContain("You're not in a running challenge right now.");
    expect(b.text).toContain('Your streak starts with your first verified day.');
    expect(b.next.href).toBe('/dashboard/settings');
  });

  it('describes a challenge that has not started', () => {
    const b = composeBriefing(input({ challenges: [running({ phase: 'starting', day: null, secsLeft: 3 * 86400 })] }));
    expect(b.text).toContain('Daily grind starts in 3 days.');
    expect(b.next.label).toBe('Get ready for the start');
  });

  it('stays under the length cap and keeps the next step', () => {
    const long = 'x'.repeat(40);
    const b = composeBriefing(
      input({
        challenges: Array.from({ length: 6 }, (_, i) => running({ title: `${long} ${i}`, today: 'verified' })),
        claimable: ['1 SOL'],
        unread: { count: 12, latest: 'y'.repeat(300) },
      }),
    );
    expect(b.text.length).toBeLessThanOrEqual(BRIEFING_MAX_CHARS);
    expect(b.text).toContain('Next:');
  });

  it('is deterministic (same facts, same text)', () => {
    expect(composeBriefing(input()).text).toBe(composeBriefing(input()).text);
  });

  it('keeps private data out of the spoken text', () => {
    const b = composeBriefing(input({ challenges: [running({ title: 'Wallet 4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T group' })] }));
    expect(b.text).not.toContain('4Nd1m');
  });
});
