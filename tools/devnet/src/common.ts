// Shared setup for the devnet scripts: env from the repo's .env.local, keypairs, devnet guard.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROGRAM_ID, assertDevnet, createProgram, keypairWallet, type CodestreakProgram } from '@codestreak/shared/program';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export function loadEnv(): void {
  const file = path.join(REPO_ROOT, '.env.local');
  if (existsSync(file)) process.loadEnvFile(file);
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set in .env.local`);
  return value;
}

/** Reads a Solana CLI keypair file (JSON array of 64 numbers). Windows paths to WSL files work. */
export function loadKeypair(envName: string): Keypair {
  const file = requireEnv(envName);
  if (!existsSync(file)) throw new Error(`${envName}: file not found: ${file}`);
  const bytes: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error(`${envName}: not a Solana keypair file`);
  return Keypair.fromSecretKey(Uint8Array.from(bytes as number[]));
}

/** Connects to SOLANA_RPC_URL, refuses anything but devnet, and checks the program is deployed. */
export async function connectDevnet(): Promise<Connection> {
  loadEnv();
  const url = process.env.SOLANA_RPC_URL?.trim() || 'https://api.devnet.solana.com';
  const connection = new Connection(url, 'confirmed');
  await assertDevnet(connection);

  const configured = process.env.NEXT_PUBLIC_CODESTREAK_PROGRAM_ID?.trim();
  if (configured && configured !== PROGRAM_ID.toBase58()) {
    throw new Error(`NEXT_PUBLIC_CODESTREAK_PROGRAM_ID is ${configured}, but the client is built for ${PROGRAM_ID.toBase58()}`);
  }
  const info = await connection.getAccountInfo(PROGRAM_ID);
  if (!info?.executable) {
    throw new Error(`Program ${PROGRAM_ID.toBase58()} is not deployed on devnet yet: run scripts/wsl/deploy-devnet.sh in WSL first.`);
  }
  return connection;
}

export function programFor(connection: Connection, signer: Keypair): CodestreakProgram {
  return createProgram(connection, keypairWallet(signer));
}

export function pubkeyEnv(name: string): PublicKey {
  return new PublicKey(requireEnv(name));
}

export async function main(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
    const logs = (err as { logs?: string[] }).logs;
    if (logs?.length) console.error(logs.join('\n'));
    process.exit(1);
  }
}
