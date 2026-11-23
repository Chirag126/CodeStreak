/**
 * The site's public origin for redirects and links. Behind Render's proxy a request's own URL is the
 * internal address (http://localhost:10000), so redirects built from it send people to localhost.
 * APP_URL (the public URL, set on Render) wins; locally the request's origin is right.
 */
export function appOrigin(fallback: string): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // A malformed APP_URL is caught by env validation at startup; fall back rather than crash.
    }
  }
  return fallback;
}
