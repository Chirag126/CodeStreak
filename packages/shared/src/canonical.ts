// Canonical JSON and SHA-256 (isomorphic: browser, web server, worker).

/** JSON with object keys sorted at every level, so equal values always serialise (and hash) the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** SHA-256 of a UTF-8 string, as 32 bytes. */
export async function sha256Bytes(text: string): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** SHA-256 of a UTF-8 string, as 64 lowercase hex characters. */
export async function sha256Hex(text: string): Promise<string> {
  return Array.from(await sha256Bytes(text), (b) => b.toString(16).padStart(2, '0')).join('');
}
