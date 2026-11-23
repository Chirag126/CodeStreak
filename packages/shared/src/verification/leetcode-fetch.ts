// LeetCode public profile via Firecrawl (node-only). Live fetch every time (maxAge 0: never a
// cached page, or a code just added would be missed and an old one could be accepted).

export interface ProfileScrape {
  ok: boolean;
  /** HTTP status of the LeetCode page as Firecrawl saw it. */
  pageStatus: number | null;
  markdown: string;
  /** Page title, e.g. "lee215 - LeetCode Profile" (identifies whose profile it is). */
  title: string | null;
  error?: string;
}

export async function scrapeLeetcodeProfile(apiKey: string, handle: string, fetchImpl: typeof fetch = fetch, opts: { waitForMs?: number } = {}): Promise<ProfileScrape> {
  try {
    const res = await fetchImpl('https://api.firecrawl.dev/v2/scrape', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `https://leetcode.com/u/${encodeURIComponent(handle)}/`,
        formats: ['markdown'],
        onlyMainContent: false,
        maxAge: 0,
        waitFor: opts.waitForMs ?? 4000,
        timeout: 60000,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      data?: { markdown?: string; metadata?: { statusCode?: number; title?: string; ogTitle?: string } };
    };
    if (!res.ok || !body.success) return { ok: false, pageStatus: null, markdown: '', title: null, error: body.error ?? `HTTP ${res.status}` };
    const meta = body.data?.metadata;
    return { ok: true, pageStatus: meta?.statusCode ?? null, markdown: body.data?.markdown ?? '', title: meta?.title ?? meta?.ogTitle ?? null };
  } catch (e) {
    return { ok: false, pageStatus: null, markdown: '', title: null, error: e instanceof Error ? e.message : 'network error' };
  }
}
