import { parseEnv, publicEnvSchema, webServerEnvSchema, type PublicEnv, type WebServerEnv } from '@codestreak/shared';

/**
 * Browser-safe configuration. Each NEXT_PUBLIC_* variable is referenced literally
 * so Next.js can inline it into client bundles.
 */
export function getPublicEnv(): PublicEnv {
  return parseEnv(
    publicEnvSchema,
    {
      NEXT_PUBLIC_SOLANA_CLUSTER: process.env.NEXT_PUBLIC_SOLANA_CLUSTER,
      NEXT_PUBLIC_SOLANA_RPC_URL: process.env.NEXT_PUBLIC_SOLANA_RPC_URL,
      NEXT_PUBLIC_USDC_MINT: process.env.NEXT_PUBLIC_USDC_MINT,
      NEXT_PUBLIC_WSOL_MINT: process.env.NEXT_PUBLIC_WSOL_MINT,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      NEXT_PUBLIC_CODESTREAK_PROGRAM_ID: process.env.NEXT_PUBLIC_CODESTREAK_PROGRAM_ID,
    },
    'public',
  );
}

/** Server-only configuration. Never import this from a client component. */
export function getServerEnv(): WebServerEnv {
  if (typeof window !== 'undefined') throw new Error('getServerEnv() must only run on the server');
  return parseEnv(webServerEnvSchema, process.env, 'web server');
}
