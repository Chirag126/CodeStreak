import { describe, expect, it } from 'vitest';
import { agoToSeconds, checkBindingPage, containsVerificationCode, diffLeetcodeSnapshots, parseLeetcodeProfile } from './leetcode.js';
import { scrapeLeetcodeProfile } from './leetcode-fetch.js';

// Synthetic page with the same structure Firecrawl returned for a real profile in Phase 2.
const page = (solved: number, entries: [string, string, string][], summary = 'Coding every day') =>
  [
    'demo_user',
    '',
    summary,
    '',
    `${solved}/4115`,
    '',
    'Solved',
    '',
    'Recent AC',
    '',
    entries.map(([t, ago, id]) => `[${t}${ago}](https://leetcode.com/submissions/detail/${id}/)`).join(' '),
  ].join('\n');

describe('leetcode parsing', () => {
  it('relative times', () => {
    expect(agoToSeconds('3 days ago')).toBe(259_200);
    expect(agoToSeconds('an hour ago')).toBe(3600);
    expect(agoToSeconds('just now')).toBeNull();
  });

  it('solved count and glued title/time entries', () => {
    const p = parseLeetcodeProfile(page(42, [['Count Valid Substrings II', '13 days ago', '2191420316'], ['Two Sum', 'a month ago', '2181076640']]));
    expect(p.solved).toBe(42);
    expect(p.totalProblems).toBe(4115);
    expect(p.recentAccepted.map((r) => [r.title, r.ago])).toEqual([
      ['Count Valid Substrings II', '13 days ago'],
      ['Two Sum', 'a month ago'],
    ]);
  });

  it('private or missing profile gives nulls', () => {
    const p = parseLeetcodeProfile('This profile is private');
    expect(p.solved).toBeNull();
    expect(p.recentAccepted).toEqual([]);
    expect(p.hasRecentAcSection).toBe(false);
  });

  it('verification code is a whole token', () => {
    expect(containsVerificationCode(page(1, [], 'my code CS-VERIFY-TEST01'), 'CS-VERIFY-TEST01')).toBe(true);
    expect(containsVerificationCode(page(1, [], 'CS-VERIFY-TEST012'), 'CS-VERIFY-TEST01')).toBe(false);
  });

  it('a new solve qualifies; re-solving an old problem does not', () => {
    const anchor = parseLeetcodeProfile(page(41, [['Old', '2 days ago', '2190000000']]));
    const solvedNew = parseLeetcodeProfile(page(42, [['New', '3 minutes ago', '2200000005'], ['Old', '2 days ago', '2190000000']]));
    const resolved = parseLeetcodeProfile(page(41, [['Old', '1 minute ago', '2200000009']]));
    expect(diffLeetcodeSnapshots(anchor, solvedNew)).toMatchObject({ solvedDelta: 1, qualifies: true });
    expect(diffLeetcodeSnapshots(anchor, resolved)).toMatchObject({ solvedDelta: 0, qualifies: false });
  });

  it('missing data never qualifies', () => {
    const p = parseLeetcodeProfile('private');
    expect(diffLeetcodeSnapshots(p, p).qualifies).toBe(false);
  });
});

describe('LeetCode binding (Phase 26)', () => {
  const CODE = 'CS-LC-7KQ2M9XAB3';
  const profile = (summary: string) => `# Alice_99\n\nalice_99\n\nRank 123,456\n\n${summary}\n\n704/4115\n\nSolved\n\n## Recent AC`;

  it('accepts the exact code on the right profile', () => {
    expect(checkBindingPage({ pageStatus: 200, title: 'Alice_99 - LeetCode Profile', markdown: profile(`Hi! ${CODE}`), handle: 'alice_99', code: CODE })).toEqual({ ok: true });
  });

  it('wrong code: an old code, a different code, or the code inside a longer word all fail', () => {
    expect(checkBindingPage({ pageStatus: 200, title: 'Alice_99 - LeetCode Profile', markdown: profile('CS-LC-ZZZZZZZZZZ'), handle: 'alice_99', code: CODE })).toEqual({ ok: false, reason: 'code_missing' });
    expect(checkBindingPage({ pageStatus: 200, title: 'Alice_99 - LeetCode Profile', markdown: profile(`X${CODE}Y`), handle: 'alice_99', code: CODE })).toEqual({ ok: false, reason: 'code_missing' });
    expect(checkBindingPage({ pageStatus: 200, title: 'Alice_99 - LeetCode Profile', markdown: profile(`${CODE}9`), handle: 'alice_99', code: CODE })).toEqual({ ok: false, reason: 'code_missing' });
  });

  it('the real profile page shape (lee215, scraped live): title identifies the owner; sign-in links do not', () => {
    const real = '[Register](https://leetcode.com/accounts/signup/?next=%2Fu%2Flee215%2F)\n\nlee\n\nlee215\n\nRank98,188\n\nLee codes for fun :) CS-LC-7KQ2M9XAB3\n\n709/4123\n\nSolved';
    expect(checkBindingPage({ pageStatus: 200, title: 'lee215 - LeetCode Profile', markdown: real, handle: 'LEE215', code: CODE })).toEqual({ ok: true });
    expect(checkBindingPage({ pageStatus: 200, title: 'lee215 - LeetCode Profile', markdown: real, handle: 'lee21', code: CODE })).toEqual({ ok: false, reason: 'no_profile' });
    expect(checkBindingPage({ pageStatus: 200, title: 'LeetCode - The World\'s Leading Online Programming Learning Platform', markdown: real, handle: 'lee215', code: CODE })).toEqual({ ok: false, reason: 'no_profile' });
  });

  it("someone else's page, a missing profile, or an unreadable page never passes", () => {
    expect(checkBindingPage({ pageStatus: 200, title: 'Alice_99 - LeetCode Profile', markdown: profile(CODE), handle: 'bob', code: CODE })).toEqual({ ok: false, reason: 'no_profile' });
    expect(checkBindingPage({ pageStatus: 404, title: null, markdown: 'Page not found', handle: 'alice_99', code: CODE })).toEqual({ ok: false, reason: 'no_profile' });
    expect(checkBindingPage({ pageStatus: 500, title: 'Alice_99 - LeetCode Profile', markdown: profile(CODE), handle: 'alice_99', code: CODE })).toEqual({ ok: false, reason: 'unreadable' });
    expect(checkBindingPage({ pageStatus: 200, title: 'Alice_99 - LeetCode Profile', markdown: '   ', handle: 'alice_99', code: CODE })).toEqual({ ok: false, reason: 'unreadable' });
  });

  it('scrapes live (maxAge 0) and reports Firecrawl and network failures', async () => {
    let sent: { url?: string; maxAge?: number } = {};
    const ok = await scrapeLeetcodeProfile('key', 'alice_99', (async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ success: true, data: { markdown: 'md', metadata: { statusCode: 200 } } }));
    }) as unknown as typeof fetch);
    expect(sent).toMatchObject({ url: 'https://leetcode.com/u/alice_99/', maxAge: 0 });
    expect(ok).toEqual({ ok: true, pageStatus: 200, markdown: 'md', title: null });
    const down = await scrapeLeetcodeProfile('key', 'alice_99', (async () => new Response(JSON.stringify({ success: false, error: 'rate limited' }), { status: 429 })) as unknown as typeof fetch);
    expect(down).toMatchObject({ ok: false, error: 'rate limited' });
    const net = await scrapeLeetcodeProfile('key', 'alice_99', (async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch);
    expect(net).toMatchObject({ ok: false, error: 'ECONNRESET' });
  });
});
