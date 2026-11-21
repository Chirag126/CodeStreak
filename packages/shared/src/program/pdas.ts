import { PublicKey } from '@solana/web3.js';

import { CODESTREAK_IDL_JSON } from './idl/codestreak.idl.js';

/** The CodeStreak program on devnet (from the IDL, which `anchor build` fills from declare_id!). */
export const PROGRAM_ID = new PublicKey(CODESTREAK_IDL_JSON.address);

export const BPF_UPGRADEABLE_LOADER_ID = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

const enc = new TextEncoder();
export const SEEDS = {
  config: enc.encode('config'),
  challenge: enc.encode('challenge'),
  vault: enc.encode('vault'),
  participant: enc.encode('participant'),
  sponsor: enc.encode('sponsor'),
} as const;

/** u64 little-endian, as the program writes `challenge_id.to_le_bytes()`. */
export function u64Le(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new RangeError('u64 out of range');
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

const find = (seeds: Uint8Array[], programId: PublicKey): PublicKey => PublicKey.findProgramAddressSync(seeds, programId)[0];

export function configPda(programId = PROGRAM_ID): PublicKey {
  return find([SEEDS.config], programId);
}

export function challengePda(creator: PublicKey, challengeId: bigint, programId = PROGRAM_ID): PublicKey {
  return find([SEEDS.challenge, creator.toBytes(), u64Le(challengeId)], programId);
}

export function vaultPda(challenge: PublicKey, programId = PROGRAM_ID): PublicKey {
  return find([SEEDS.vault, challenge.toBytes()], programId);
}

export function participantPda(challenge: PublicKey, user: PublicKey, programId = PROGRAM_ID): PublicKey {
  return find([SEEDS.participant, challenge.toBytes(), user.toBytes()], programId);
}

export function sponsorReceiptPda(challenge: PublicKey, sponsor: PublicKey, programId = PROGRAM_ID): PublicKey {
  return find([SEEDS.sponsor, challenge.toBytes(), sponsor.toBytes()], programId);
}

/** ProgramData account of an upgradeable program (needed by `initialize_config`). */
export function programDataAddress(programId = PROGRAM_ID): PublicKey {
  return find([programId.toBytes()], BPF_UPGRADEABLE_LOADER_ID);
}
