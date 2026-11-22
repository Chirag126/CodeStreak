// Linked provider accounts (pure).

export interface GithubAccount {
  /** Numeric GitHub user ID (immutable): the key for verification. */
  id: string;
  /** Current username: display only (it can be renamed and later reused by someone else). */
  username: string;
}

const NUMERIC_ID = /^[1-9][0-9]{0,19}$/;
const USERNAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/**
 * Reads the GitHub account from a Supabase identity (as returned by the admin API, never from the
 * browser). Returns null for anything that isn't a well-formed GitHub identity.
 */
export function githubAccountFromIdentity(identity: { provider?: string; id?: string; identity_data?: Record<string, unknown> | null } | null | undefined): GithubAccount | null {
  if (!identity || identity.provider !== 'github') return null;
  const data = identity.identity_data ?? {};
  const rawId = data['provider_id'] ?? data['sub'] ?? identity.id;
  const id = typeof rawId === 'number' ? String(rawId) : typeof rawId === 'string' ? rawId : '';
  const rawName = data['user_name'] ?? data['preferred_username'];
  const username = typeof rawName === 'string' ? rawName : '';
  if (!NUMERIC_ID.test(id) || !USERNAME.test(username)) return null;
  return { id, username };
}

export type Provider = 'github' | 'leetcode';

/**
 * Which linked accounts a challenge's rules need before joining:
 *  - "all" rules: every listed provider;
 *  - "any" rules: at least one of them.
 */
export function missingProviders(rules: { providers?: Provider[]; providerRule?: 'any' | 'all' } | null | undefined, linked: Provider[]): { ok: true } | { ok: false; need: Provider[]; rule: 'any' | 'all' } {
  const providers = rules?.providers ?? [];
  if (providers.length === 0) return { ok: true };
  const rule = providers.length > 1 ? (rules?.providerRule ?? 'any') : 'all';
  const missing = providers.filter((p) => !linked.includes(p));
  if (rule === 'all') return missing.length ? { ok: false, need: missing, rule } : { ok: true };
  return missing.length < providers.length ? { ok: true } : { ok: false, need: providers, rule };
}

export const PROVIDER_LABELS: Record<Provider, string> = { github: 'GitHub', leetcode: 'LeetCode' };
