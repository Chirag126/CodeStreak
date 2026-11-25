import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import {
  CODESTREAK_IDL_JSON,
  PROGRAM_ID,
  anchor,
  badgeAuthorityPda,
  badgeMintPda,
  badgeTokenAccount,
  canonicalJson,
  challengePda,
  challengePhase,
  configPda,
  createProgram,
  dayIndex,
  enumVariant,
  participantPda,
  rulesHash,
  u64Le,
  vaultPda,
  type ChallengeTimes,
} from './index.js';

describe('program id and IDL', () => {
  it('matches declare_id! and Anchor.toml', () => {
    expect(PROGRAM_ID.toBase58()).toBe('A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J');
  });

  it('exposes every instruction', () => {
    expect(CODESTREAK_IDL_JSON.instructions.map((i) => i.name).sort()).toEqual([
      'activate_shield',
      'cancel_pool',
      'claim_refund',
      'claim_reward',
      'claim_sponsor_refund',
      'finalize_participant',
      'initialize_config',
      'initialize_pool',
      'join_pool',
      'mint_badge',
      'record_verification',
      'seal_badge',
      'set_entry_gate',
      'settle_challenge',
      'sponsor_pool',
      'update_config',
    ]);
  });

  it('loads Anchor and builds a read-only program with camelCase methods', () => {
    expect(typeof anchor.Program).toBe('function');
    const fakeConnection = { rpcEndpoint: 'http://unused' } as never;
    const program = createProgram(fakeConnection);
    expect(program.programId.equals(PROGRAM_ID)).toBe(true);
    expect(typeof program.methods.initializePool).toBe('function');
    expect(typeof program.account.challenge.fetch).toBe('function');
  });
});

describe('PDAs', () => {
  it('encodes u64 little-endian like the program', () => {
    expect(Array.from(u64Le(1n))).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(u64Le(0x0102n))).toEqual([2, 1, 0, 0, 0, 0, 0, 0]);
    expect(() => u64Le(-1n)).toThrow();
  });

  it('derives deterministic, distinct addresses', () => {
    const creator = Keypair.generate().publicKey;
    const user = Keypair.generate().publicKey;
    const a = challengePda(creator, 1n);
    expect(a.equals(challengePda(creator, 1n))).toBe(true);
    expect(a.equals(challengePda(creator, 2n))).toBe(false);
    const addresses = [configPda(), a, vaultPda(a), participantPda(a, user)].map((k) => k.toBase58());
    expect(new Set(addresses).size).toBe(4);
    for (const k of addresses) expect(PublicKey.isOnCurve(new PublicKey(k).toBytes())).toBe(false);
  });
});

describe('lifecycle mirror (same vectors as the Rust unit tests)', () => {
  const c: ChallengeTimes = {
    state: 'open',
    startTs: 1_000,
    dayLengthSecs: 100,
    numDays: 3,
    joinDeadlineTs: 900,
    verifyWindowSecs: 100,
    disputeWindowSecs: 100,
  };

  it('follows the clock', () => {
    expect(challengePhase(c, 899)).toBe('joining');
    expect(challengePhase(c, 900)).toBe('starting');
    expect(challengePhase(c, 1_000)).toBe('active');
    expect(challengePhase(c, 1_300)).toBe('verifying');
    expect(challengePhase(c, 1_400)).toBe('disputeWindow');
    expect(challengePhase(c, 1_500)).toBe('awaitingSettlement');
    expect(challengePhase({ ...c, state: 'cancelled' }, 950)).toBe('cancelled');
    expect(challengePhase({ ...c, state: 'settled' }, 950)).toBe('settled');
  });

  it('computes the day index', () => {
    expect(dayIndex(c, 999)).toBeNull();
    expect(dayIndex(c, 1_099)).toBe(0);
    expect(dayIndex(c, 1_100)).toBe(1);
    expect(dayIndex(c, 1_300)).toBeNull();
  });

  it('reads Anchor enum values', () => {
    expect(enumVariant({ settled: {} })).toBe('settled');
    expect(() => enumVariant({})).toThrow();
  });
});

describe('rules hash', () => {
  it('is independent of key order', async () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: 'x' } })).toBe('{"a":{"c":"x","d":[1,2]},"b":1}');
    const h1 = await rulesHash({ a: 1, b: 2 });
    const h2 = await rulesHash({ b: 2, a: 1 });
    expect(h1).toEqual(h2);
    expect(h1).toHaveLength(32);
    // SHA-256("{}")
    expect(Buffer.from(await rulesHash({})).toString('hex')).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  });
});

describe('badge PDAs (Phase 34)', () => {
  it('one mint per participant, one program-wide authority, the badge in a Token-2022 account', () => {
    const a = Keypair.generate().publicKey;
    const b = Keypair.generate().publicKey;
    const owner = Keypair.generate().publicKey;
    expect(badgeMintPda(a).equals(badgeMintPda(a))).toBe(true);
    expect(badgeMintPda(a).equals(badgeMintPda(b))).toBe(false);
    expect(badgeAuthorityPda().equals(PublicKey.findProgramAddressSync([new TextEncoder().encode('badge_authority')], PROGRAM_ID)[0])).toBe(true);
    expect(badgeTokenAccount(owner, a).equals(badgeTokenAccount(owner, b))).toBe(false);
    expect(CODESTREAK_IDL_JSON.instructions.some((i) => i.name === 'mint_badge')).toBe(true);
  });
});
