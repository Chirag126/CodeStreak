import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  addressProblem,
  base58Decode,
  base58Encode,
  buildBindingMessage,
  buildLoginMessage,
  checkBinding,
  checkLogin,
  isSolanaAddress,
  LOGIN_TTL_SECONDS,
  type LoginChallengeRecord,
  NONCE_TTL_SECONDS,
  type NonceRecord,
} from './index.js';

function newWallet() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x!, 'base64url');
  return { address: base58Encode(raw), sign: (msg: string) => new Uint8Array(sign(null, Buffer.from(msg), privateKey)) };
}

function challenge(address: string, now = new Date('2026-11-22T10:00:00Z')) {
  const expiresAt = new Date(now.getTime() + NONCE_TTL_SECONDS * 1000);
  const message = buildBindingMessage({
    domain: 'localhost:3000',
    address,
    publicId: 'CS-7KQ2M9XA',
    nonce: randomBytes(16).toString('hex'),
    issuedAt: now,
    expiresAt,
  });
  const record: NonceRecord = { address, message, expiresAt, usedAt: null };
  return { record, message, now };
}

describe('base58 and addresses', () => {
  it('round-trips and recognizes real addresses', () => {
    const bytes = randomBytes(32);
    expect(Buffer.from(base58Decode(base58Encode(bytes))!)).toEqual(bytes);
    expect(isSolanaAddress('9piHsiBrsPrPJTYhiFk8PPKGhpndGZGgJmjBZtxJAHsD')).toBe(true);
    expect(isSolanaAddress('11111111111111111111111111111111')).toBe(true); // system program
  });

  it('explains why an address is rejected', () => {
    expect(addressProblem('0x52908400098527886E0F7030069857D2E4169EE7')).toMatch(/Ethereum \(0x\)/);
    expect(addressProblem('not-an-address')).toMatch(/not a valid Solana address/);
    expect(addressProblem('9piHsiBrsPrPJTYhiFk8PPKGhpndGZGgJmjBZtxJAHsD')).toBeNull();
  });
});

describe('binding check', () => {
  it('accepts a fresh, correctly signed message', () => {
    const w = newWallet();
    const { record, message, now } = challenge(w.address);
    expect(checkBinding({ record, address: w.address, signedMessage: message, signature: w.sign(message), now })).toEqual({ ok: true });
  });

  it('rejects a replayed nonce', () => {
    const w = newWallet();
    const { record, message, now } = challenge(w.address);
    const used = { ...record, usedAt: now };
    expect(checkBinding({ record: used, address: w.address, signedMessage: message, signature: w.sign(message), now })).toMatchObject({
      ok: false,
      reason: 'nonce_used',
    });
  });

  it('rejects an expired nonce (exactly at expiry and after)', () => {
    const w = newWallet();
    const { record, message } = challenge(w.address);
    for (const t of [record.expiresAt, new Date(record.expiresAt.getTime() + 60_000)]) {
      expect(checkBinding({ record, address: w.address, signedMessage: message, signature: w.sign(message), now: t })).toMatchObject({
        reason: 'nonce_expired',
      });
    }
  });

  it('rejects a 0x address', () => {
    const w = newWallet();
    const { record, message, now } = challenge(w.address);
    const evm = '0x52908400098527886E0F7030069857D2E4169EE7';
    expect(checkBinding({ record, address: evm, signedMessage: message, signature: w.sign(message), now })).toMatchObject({ reason: 'evm_address' });
  });

  it('rejects another wallet, an edited message and a forged signature', () => {
    const w = newWallet();
    const other = newWallet();
    const { record, message, now } = challenge(w.address);
    expect(checkBinding({ record, address: other.address, signedMessage: message, signature: other.sign(message), now })).toMatchObject({
      reason: 'address_mismatch',
    });
    const edited = message.replace('CS-7KQ2M9XA', 'CS-AAAAAAAA');
    expect(checkBinding({ record, address: w.address, signedMessage: edited, signature: w.sign(edited), now })).toMatchObject({
      reason: 'message_mismatch',
    });
    expect(checkBinding({ record, address: w.address, signedMessage: message, signature: other.sign(message), now })).toMatchObject({
      reason: 'bad_signature',
    });
    expect(checkBinding({ record, address: w.address, signedMessage: message, signature: new Uint8Array(64), now })).toMatchObject({
      reason: 'bad_signature',
    });
  });

  it('puts every checked field in the message the user sees', () => {
    const { message } = challenge('9piHsiBrsPrPJTYhiFk8PPKGhpndGZGgJmjBZtxJAHsD');
    expect(message).toContain('9piHsiBrsPrPJTYhiFk8PPKGhpndGZGgJmjBZtxJAHsD');
    expect(message).toMatch(/Account: CS-7KQ2M9XA/);
    expect(message).toMatch(/Network: Solana devnet/);
    expect(message).toMatch(/Nonce: [0-9a-f]{32}/);
    expect(message).toMatch(/does not move any funds/);
  });
});

describe('wallet login', () => {
  const now = new Date('2026-11-22T10:00:00Z');
  const browser = 'a'.repeat(64);
  function login(address: string) {
    const expiresAt = new Date(now.getTime() + LOGIN_TTL_SECONDS * 1000);
    const message = buildLoginMessage({ domain: 'codestreak.app', uri: 'https://codestreak.app', address, nonce: randomBytes(16).toString('hex'), issuedAt: now, expiresAt });
    const record: LoginChallengeRecord = { address, message, browserHash: browser, expiresAt, usedAt: null };
    return { record, message };
  }

  it('accepts the linked wallet signing its own challenge', () => {
    const w = newWallet();
    const { record, message } = login(w.address);
    expect(message.split('\n')[0]).toBe('codestreak.app wants you to sign in with your Solana account:');
    expect(checkLogin({ record, address: w.address, browserHash: browser, signature: w.sign(message), now })).toEqual({ ok: true });
  });

  it('rejects a replayed, expired or other-browser attempt', () => {
    const w = newWallet();
    const { record, message } = login(w.address);
    const sig = w.sign(message);
    expect(checkLogin({ record: { ...record, usedAt: now }, address: w.address, browserHash: browser, signature: sig, now }).ok).toBe(false);
    expect(checkLogin({ record, address: w.address, browserHash: browser, signature: sig, now: record.expiresAt })).toMatchObject({ reason: 'expired' });
    expect(checkLogin({ record, address: w.address, browserHash: 'b'.repeat(64), signature: sig, now })).toMatchObject({ reason: 'other_browser' });
  });

  it('rejects a different wallet, a wrong message, and a wallet-linking signature reused as a login', () => {
    const w = newWallet();
    const other = newWallet();
    const { record, message } = login(w.address);
    expect(checkLogin({ record, address: other.address, browserHash: browser, signature: other.sign(message), now })).toMatchObject({ reason: 'address_mismatch' });
    expect(checkLogin({ record, address: w.address, browserHash: browser, signature: other.sign(message), now })).toMatchObject({ reason: 'bad_signature' });
    expect(checkLogin({ record, address: w.address, browserHash: browser, signature: w.sign(message + ' '), now })).toMatchObject({ reason: 'bad_signature' });
    const binding = challenge(w.address, now).message;
    expect(binding).not.toBe(message);
    expect(checkLogin({ record, address: w.address, browserHash: browser, signature: w.sign(binding), now })).toMatchObject({ reason: 'bad_signature' });
  });
});
