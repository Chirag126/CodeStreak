// Wallet ownership proof: build a sign-in message and verify an ed25519 signature
// with Node's built-in crypto (no tweetnacl / bs58 dependency).
import { createPublicKey, verify, randomBytes } from 'node:crypto';
import { base58Decode } from '../../scripts/check-env.mjs';

export function newNonce() {
  return randomBytes(16).toString('hex');
}

/** Human-readable message the wallet shows. Every field is checked by the server. */
export function buildSignInMessage({ domain, address, nonce, issuedAt, chain = 'devnet', userId = 'spike-user' }) {
  return [
    `${domain} wants you to link your Solana account:`,
    address,
    '',
    'Link this wallet to your CodeStreak account. This does not move funds or cost fees.',
    '',
    `URI: https://${domain}`,
    `Chain: ${chain}`,
    `User: ${userId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');
}

/** Verifies an ed25519 signature for a base58 Solana address. */
export function verifySolanaSignature(address, messageBytes, signatureBytes) {
  const pub = base58Decode(address);
  if (!pub || pub.length !== 32) return false;
  if (!signatureBytes || signatureBytes.length !== 64) return false;
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pub).toString('base64url') }, format: 'jwk' });
  return verify(null, Buffer.from(messageBytes), key, Buffer.from(signatureBytes));
}
