// Wallet ownership proof (Node-only: signature checks use node:crypto). Import from
// "@codestreak/shared/wallet" on the server. The flow:
//   1. server issues a single-use nonce for (profile, address), valid NONCE_TTL_SECONDS;
//   2. the wallet signs the exact binding message (Wallet Standard `solana:signMessage`);
//   3. server checks address, message, expiry, unused nonce and the ed25519 signature,
//      then marks the nonce used in the same statement that reads it (no replay).
import { createPublicKey, verify } from 'node:crypto';

export const NONCE_TTL_SECONDS = 5 * 60;

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));

export function base58Decode(input: string): Uint8Array | null {
  if (!input) return null;
  let bytes: number[] = [];
  for (const char of input) {
    const value = INDEX.get(char);
    if (value === undefined) return null;
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of input) {
    if (char !== '1') break;
    bytes.push(0);
  }
  bytes = bytes.reverse();
  return Uint8Array.from(bytes);
}

export function base58Encode(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i]! << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (const byte of bytes) {
    if (byte !== 0) break;
    out += '1';
  }
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]!];
  return out;
}

export function isEvmAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address.trim());
}

/** A Solana address is base58 that decodes to exactly 32 bytes. */
export function isSolanaAddress(address: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return false;
  return base58Decode(address)?.length === 32;
}

/** Why an address can't be linked, in words for the user; null if it can. */
export function addressProblem(address: string): string | null {
  if (isEvmAddress(address)) {
    return 'That is an Ethereum (0x) address. In MetaMask, switch to your Solana account, or use Phantom.';
  }
  if (!isSolanaAddress(address)) return 'That is not a valid Solana address.';
  return null;
}

export interface BindingMessageInput {
  domain: string;
  address: string;
  publicId: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}

/** The exact text the wallet shows and signs. Every line is checked by the server. */
export function buildBindingMessage(m: BindingMessageInput): string {
  return [
    `${m.domain} wants you to link your Solana wallet:`,
    m.address,
    '',
    'Link this wallet to your CodeStreak account. Signing is free and does not move any funds.',
    '',
    `Account: ${m.publicId}`,
    'Network: Solana devnet',
    `Nonce: ${m.nonce}`,
    `Issued At: ${m.issuedAt.toISOString()}`,
    `Expires At: ${m.expiresAt.toISOString()}`,
  ].join('\n');
}

/** ed25519 signature check for a base58 Solana address. */
export function verifySolanaSignature(address: string, message: Uint8Array, signature: Uint8Array): boolean {
  const publicKey = base58Decode(address);
  if (publicKey?.length !== 32 || signature.length !== 64) return false;
  try {
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(publicKey).toString('base64url') }, format: 'jwk' });
    return verify(null, message, key, signature);
  } catch {
    return false;
  }
}

/** The stored challenge for one binding attempt (a wallet_nonces row). */
export interface NonceRecord {
  address: string;
  message: string;
  expiresAt: Date;
  usedAt: Date | null;
}

export type BindingCheck =
  | { ok: true }
  | {
      ok: false;
      reason: 'evm_address' | 'invalid_address' | 'nonce_used' | 'nonce_expired' | 'address_mismatch' | 'message_mismatch' | 'bad_signature';
      message: string;
    };

/** Checks a signed binding attempt against its stored challenge. Pure apart from the crypto. */
export function checkBinding(input: { record: NonceRecord; address: string; signedMessage: string; signature: Uint8Array; now: Date }): BindingCheck {
  const { record, address, signedMessage, signature, now } = input;
  if (isEvmAddress(address)) return { ok: false, reason: 'evm_address', message: addressProblem(address)! };
  if (!isSolanaAddress(address)) return { ok: false, reason: 'invalid_address', message: 'That is not a valid Solana address.' };
  if (record.usedAt) return { ok: false, reason: 'nonce_used', message: 'This signature was already used. Start again.' };
  if (now.getTime() >= record.expiresAt.getTime()) {
    return { ok: false, reason: 'nonce_expired', message: 'The request expired. Start again and sign within 5 minutes.' };
  }
  if (record.address !== address) return { ok: false, reason: 'address_mismatch', message: 'The signing wallet does not match the request.' };
  if (record.message !== signedMessage) return { ok: false, reason: 'message_mismatch', message: 'The signed message was changed.' };
  if (!verifySolanaSignature(address, new TextEncoder().encode(signedMessage), signature)) {
    return { ok: false, reason: 'bad_signature', message: 'The signature does not match this wallet.' };
  }
  return { ok: true };
}
