import { ACTION_HEADERS } from '@codestreak/shared';

/** JSON with the Actions CORS and spec headers (every Blink response, errors included). */
export function actionJson(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...ACTION_HEADERS, ...extra } });
}

/** ActionError: a 4xx/5xx the Blink shows to the user as-is. */
export function actionError(message: string, status = 400): Response {
  return actionJson({ message }, status, { 'Cache-Control': 'no-store' });
}

/** CORS preflight: the same headers, no body. */
export function actionOptions(): Response {
  return new Response(null, { status: 204, headers: ACTION_HEADERS });
}

/** Reads the POST body as JSON; null when it isn't JSON (or too large). */
export async function readJsonBody(req: Request): Promise<unknown> {
  const text = await req.text().catch(() => '');
  if (!text || text.length > 4096) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
