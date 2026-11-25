import { parseWidgetFile, WIDGET_COLORS, WIDGET_SIZE, widgetSvg, widgetTheme } from '@codestreak/shared';
import { type NextRequest } from 'next/server';
import { appOrigin } from '@/lib/app-origin';
import { widgetImage } from '@/lib/widget/card';
import { loadWidget, widgetCache } from '@/lib/widget/load';

export const dynamic = 'force-dynamic';

/**
 * Phase 38 image widget: /api/widget/<username>.svg | .png | .jpg  (?theme=light). Public, for
 * README files, blogs and image tags anywhere. An unknown, hidden or malformed name gets a clean
 * "Profile not found" card (status 200, so every <img> shows it; X-CodeStreak-Profile says why).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const parsed = parseWidgetFile(file);
  // A bad name still gets a placeholder in the format it asked for.
  const format = parsed?.format ?? (/\.jpe?g$/i.test(file) ? 'jpg' : /\.png$/i.test(file) ? 'png' : 'svg');
  const theme = widgetTheme(req.nextUrl.searchParams.get('theme'));
  const { model, ok } = parsed ? await loadWidget(parsed.username) : { model: { found: false as const }, ok: true };
  const headers: Record<string, string> = {
    'Cache-Control': widgetCache(model, ok),
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
    'X-CodeStreak-Profile': model.found ? 'found' : 'not-found',
  };

  if (format === 'svg') {
    return new Response(widgetSvg(model, theme), {
      headers: { ...headers, 'Content-Type': 'image/svg+xml; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" },
    });
  }
  const png = widgetImage(model, theme, WIDGET_SIZE, { ...headers, 'Content-Type': 'image/png' });
  if (format === 'png') return png;

  // JPG: the PNG re-encoded with sharp (installed with Next). Without it, send the PNG's address.
  try {
    const { default: sharp } = await import('sharp');
    const jpg = await sharp(Buffer.from(await png.arrayBuffer())).flatten({ background: WIDGET_COLORS[theme].card }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    return new Response(new Uint8Array(jpg), { headers: { ...headers, 'Content-Type': 'image/jpeg' } });
  } catch (e) {
    console.error('[widget] jpg encoding unavailable:', e instanceof Error ? e.message : e);
    const url = new URL(req.nextUrl.pathname.replace(/\.jpe?g$/i, '.png') + req.nextUrl.search, appOrigin(req.nextUrl.origin));
    return Response.redirect(url, 307);
  }
}
