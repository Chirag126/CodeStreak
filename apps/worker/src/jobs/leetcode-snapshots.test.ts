import { describe, expect, it, vi } from 'vitest';
import { createLeetcodeSnapshotJob } from './leetcode-snapshots.js';

const ctx = { log: () => {} };
const PROFILE = 'alice_99\n101/4123\n\nSolved\n\nEasy\n\n60/978\n\nMed.\n\n31/2152\n\nHard\n\n10/993\n\nRecent AC\n\n[Merge Intervals15 minutes ago](https://leetcode.com/submissions/detail/2200000001/)';

describe('LeetCode snapshot job', () => {
  it('snapshots each due profile and stores it (readable or not)', async () => {
    const inserted: unknown[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/rpc/leetcode_snapshot_targets')) return Response.json([{ profile_id: 'p1', handle: 'alice_99' }, { profile_id: 'p2', handle: 'bob' }]);
      if (url === 'https://api.firecrawl.dev/v2/scrape') {
        const target = JSON.parse(init!.body as string).url as string;
        return target.includes('alice_99')
          ? Response.json({ success: true, data: { markdown: PROFILE, metadata: { statusCode: 200, title: 'alice_99 - LeetCode Profile' } } })
          : Response.json({ success: false, error: 'timeout' }, { status: 408 });
      }
      if (url.endsWith('/rest/v1/leetcode_snapshots')) {
        inserted.push(JSON.parse(init!.body as string));
        return new Response(null, { status: 201 });
      }
      return new Response(null, { status: 404 });
    });
    const job = createLeetcodeSnapshotJob({ supabaseUrl: 'https://x.supabase.co', serviceRoleKey: 'srk', firecrawlApiKey: 'fc', fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(job(ctx)).resolves.toEqual({ due: 2, stored: 2, unreadable: 1 });
    expect(inserted[0]).toMatchObject({ profile_id: 'p1', handle: 'alice_99', source: 'scheduled', readable: true, solved: 101, medium: 31 });
    expect(inserted[1]).toMatchObject({ profile_id: 'p2', readable: false, error: 'timeout' });
  });

  it('is skipped without Supabase or Firecrawl configured', async () => {
    await expect(createLeetcodeSnapshotJob({})(ctx)).resolves.toEqual({ skipped: true });
  });
});
