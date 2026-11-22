import 'server-only';

import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';

let cached: Keypair | null = null;

/**
 * The relayer key: RELAYER_KEYPAIR_JSON (Render) or RELAYER_KEYPAIR_PATH (local file). It pays
 * fees and rent for user actions and co-signs private joins; it never holds user funds.
 */
export function relayerKeypair(): Keypair {
  if (cached) return cached;
  const json = process.env.RELAYER_KEYPAIR_JSON?.trim() || (process.env.RELAYER_KEYPAIR_PATH ? readFileSync(process.env.RELAYER_KEYPAIR_PATH.trim(), 'utf8') : '');
  if (!json) throw new Error('Relayer key not configured (RELAYER_KEYPAIR_JSON or RELAYER_KEYPAIR_PATH)');
  const bytes: unknown = JSON.parse(json);
  if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error('Relayer key is not a Solana keypair');
  const keypair = Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
  const expected = process.env.RELAYER_PUBKEY?.trim();
  if (expected && keypair.publicKey.toBase58() !== expected) throw new Error('Relayer key does not match RELAYER_PUBKEY');
  cached = keypair;
  return keypair;
}
