import { widgetHtml, widgetTheme } from '@codestreak/shared';
import { type NextRequest } from 'next/server';
import { appOrigin } from '@/lib/app-origin';
import { loadWidget, widgetCache } from '@/lib/widget/load';
import { PUBLIC_READ, overLimit, tooManyRequests } from '@/lib/http/rate-limit';

export const dynamic = 'force-dynamic';

/**
 * Phase 38 iframe widget: /embed/<username> (?theme=light). A complete, tiny HTML page with no
 * JavaScript and no app chrome, allowed inside frames on any site. Unknown or hidden profiles get
 * the same clean placeholder.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const wait = overLimit(req, PUBLIC_READ);
  if (wait) return tooManyRequests(wait);
  const { model, ok } = await loadWidget((await params).username);
  const html = widgetHtml(model, widgetTheme(req.nextUrl.searchParams.get('theme')), appOrigin(req.nextUrl.origin));
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': widgetCache(model, ok),
      // Framing on any site is the point; nothing else may load or run.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors *; base-uri 'none'; form-action 'none'",
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-CodeStreak-Profile': model.found ? 'found' : 'not-found',
    },
  });
}
