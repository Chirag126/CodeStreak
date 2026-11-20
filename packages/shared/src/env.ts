// Runtime environment validation (zod). Isomorphic: no Node-only APIs.
// Error messages name the variable and the problem, never the value.
import { z } from 'zod';
import { WSOL_MINT } from './constants.js';

const BASE58_PUBKEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Decodes the `role` claim of a JWT without verifying it (only used to reject service_role in public vars). */
export function jwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload: unknown = JSON.parse(atob(padded));
    return typeof payload === 'object' && payload !== null && 'role' in payload && typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/** Patterns that must never appear in a browser-visible (NEXT_PUBLIC_*) variable. */
const SECRET_PATTERNS: { name: string; test: (v: string) => boolean }[] = [
  { name: 'Supabase secret key', test: (v) => v.includes('sb_secret_') },
  { name: 'Supabase service_role JWT', test: (v) => jwtRole(v) === 'service_role' },
  { name: 'GitHub token', test: (v) => /\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/.test(v) },
  { name: 'Firecrawl key', test: (v) => /\bfc-[A-Za-z0-9]{24,}/.test(v) },
  { name: 'sk_ API key', test: (v) => /\bsk_[A-Za-z0-9]{32,}/.test(v) },
  { name: 'Solana keypair array', test: (v) => /\[\s*(?:\d{1,3}\s*,\s*){63}\d{1,3}\s*\]/.test(v) },
];

export const pubkeySchema = z.string().regex(BASE58_PUBKEY, 'must be a base58 Solana public key');
const devnet = z.literal('devnet', { error: 'must be "devnet" (CodeStreak never targets mainnet)' });
const devnetUrl = z.url().refine((u) => !/mainnet/i.test(u), 'mainnet URLs are not allowed');
const publishableKey = z
  .string()
  .min(1)
  .refine((v) => !v.startsWith('sb_secret_') && jwtRole(v) !== 'service_role', 'must be the publishable key, never the secret/service_role key');

/** Browser-visible configuration. Every key must be referenced literally so Next.js can inline it. */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SOLANA_CLUSTER: devnet,
  NEXT_PUBLIC_SOLANA_RPC_URL: devnetUrl,
  NEXT_PUBLIC_USDC_MINT: pubkeySchema,
  NEXT_PUBLIC_WSOL_MINT: z.literal(WSOL_MINT, { error: `must be the native mint ${WSOL_MINT}` }),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  /** Required from Phase 9 (program deploy). */
  NEXT_PUBLIC_CODESTREAK_PROGRAM_ID: pubkeySchema.optional(),
});
export type PublicEnv = z.infer<typeof publicEnvSchema>;

/** Server-side configuration of the web app. Optional fields become required in the phase noted. */
export const webServerEnvSchema = publicEnvSchema.extend({
  SOLANA_CLUSTER: devnet,
  SOLANA_RPC_URL: devnetUrl,
  APP_URL: z.url(),
  /** Phase 10 (database). */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  /** Phase 15 (relayer): one of the two. The relayer key lives only in the web service. */
  RELAYER_PUBKEY: pubkeySchema.optional(),
  RELAYER_KEYPAIR_PATH: z.string().min(1).optional(),
  RELAYER_KEYPAIR_JSON: z.string().min(1).optional(),
});
export type WebServerEnv = z.infer<typeof webServerEnvSchema>;

/** Worker service configuration. The verifier key lives only in the worker. */
export const workerEnvSchema = z.object({
  SOLANA_CLUSTER: devnet,
  SOLANA_RPC_URL: devnetUrl,
  /** Shared secret for Supabase pg_cron -> worker job calls. */
  WORKER_JOB_SECRET: z.string().min(32, 'must be at least 32 characters (32 random bytes as hex)'),
  /** Render injects PORT; 10000 is Render's default. */
  PORT: z.coerce.number().int().positive().default(10000),
  /** Phase 10. */
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  /** Phase 24 / 26. */
  GITHUB_API_TOKEN: z.string().min(1).optional(),
  FIRECRAWL_API_KEY: z.string().min(1).optional(),
  /** Phase 28. */
  VERIFIER_PUBKEY: pubkeySchema.optional(),
  VERIFIER_KEYPAIR_PATH: z.string().min(1).optional(),
  VERIFIER_KEYPAIR_JSON: z.string().min(1).optional(),
  /** Phase 33. */
  ELEVENLABS_API_KEY: z.string().min(1).optional(),
  ELEVENLABS_VOICE_ID: z.string().min(1).optional(),
});
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export class EnvError extends Error {
  constructor(
    readonly label: string,
    readonly problems: string[],
  ) {
    super(`Invalid ${label} environment:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

/** Lists NEXT_PUBLIC_* variables whose value looks like a secret. */
export function findSecretsInPublicVars(source: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  for (const [name, value] of Object.entries(source)) {
    if (!name.startsWith('NEXT_PUBLIC_') || !value) continue;
    for (const p of SECRET_PATTERNS) {
      if (p.test(value)) problems.push(`${name}: looks like a ${p.name}; secrets must never be in NEXT_PUBLIC_* variables`);
    }
  }
  return problems;
}

/**
 * Validates `source` (usually process.env) against `schema`.
 * Empty strings count as unset, so blank lines copied from .env.example behave like missing values.
 */
export function parseEnv<S extends z.ZodType>(schema: S, source: Record<string, string | undefined>, label: string): z.infer<S> {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (v !== undefined && v !== '') cleaned[k] = v;

  const problems = findSecretsInPublicVars(cleaned);
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const name = issue.path.map(String).join('.') || '(root)';
      problems.push(`${name}: ${issue.message}`);
    }
  }
  if (problems.length > 0) throw new EnvError(label, problems);
  return (result as { data: z.infer<S> }).data;
}
