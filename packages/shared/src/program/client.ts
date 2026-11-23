import type { IdlAccounts, IdlTypes, Program, Provider } from '@anchor-lang/core';
import type { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { VersionedTransaction } from '@solana/web3.js';

import { canonicalJson, sha256Bytes } from '../canonical.js';
import { anchor } from './anchor.js';
import { CODESTREAK_IDL } from './idl/codestreak.idl.js';
import type { Codestreak } from './idl/codestreak.types.js';
import { type ChallengeTimes, type PoolStateName, challengePhase, enumVariant } from './lifecycle.js';

export type CodestreakProgram = Program<Codestreak>;
export type ConfigAccount = IdlAccounts<Codestreak>['config'];
export type ChallengeAccount = IdlAccounts<Codestreak>['challenge'];
export type ParticipantAccount = IdlAccounts<Codestreak>['participant'];
export type SponsorReceiptAccount = IdlAccounts<Codestreak>['sponsorReceipt'];
export type InitializePoolParams = IdlTypes<Codestreak>['initializePoolParams'];
export type DayResult = IdlTypes<Codestreak>['dayResult'];

/** What AnchorProvider needs from a wallet (a browser wallet adapter or a server keypair). */
export type AnchorWallet = ConstructorParameters<typeof anchor.AnchorProvider>[1];

/** Genesis hash of Solana devnet. CodeStreak refuses every other cluster. */
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

/** Throws unless `connection` points at devnet (checked by genesis hash, not by URL). */
export async function assertDevnet(connection: Connection): Promise<void> {
  const genesis = await connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS_HASH) {
    throw new Error(`Refusing to run: ${connection.rpcEndpoint} is not Solana devnet (genesis ${genesis}).`);
  }
}

/** Wraps a server-side keypair (relayer, verifier, scripts) as an Anchor wallet. Never used in browsers. */
export function keypairWallet(keypair: Keypair): AnchorWallet {
  const sign = <T extends Transaction | VersionedTransaction>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([keypair]);
    else (tx as Transaction).partialSign(keypair);
    return tx;
  };
  return {
    publicKey: keypair.publicKey,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => sign(tx),
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) => txs.map(sign),
  };
}

/**
 * Typed program client. Without a wallet it can only read (fetch accounts, build instructions);
 * with one it can also send (`.rpc()`), signing as that wallet.
 */
export function createProgram(connection: Connection, wallet?: AnchorWallet): CodestreakProgram {
  const provider: Provider = wallet
    ? new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed', preflightCommitment: 'confirmed' })
    : { connection };
  return new anchor.Program<Codestreak>(CODESTREAK_IDL, provider);
}

/** Plain-number timing view of a Challenge account, for `challengePhase` / `dayIndex`. */
export function challengeTimes(c: ChallengeAccount): ChallengeTimes {
  return {
    state: enumVariant<PoolStateName>(c.state),
    startTs: c.startTs.toNumber(),
    dayLengthSecs: c.dayLengthSecs,
    numDays: c.numDays,
    joinDeadlineTs: c.joinDeadlineTs.toNumber(),
    verifyWindowSecs: c.verifyWindowSecs,
    disputeWindowSecs: c.disputeWindowSecs,
  };
}

/** Fetches a challenge and derives its current phase from the chain's clock. */
export async function fetchChallenge(program: CodestreakProgram, address: PublicKey) {
  const account = await program.account.challenge.fetch(address);
  const slot = await program.provider.connection.getSlot('confirmed');
  const chainTime = (await program.provider.connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
  const times = challengeTimes(account);
  return { address, account, times, chainTime, phase: challengePhase(times, chainTime) };
}

export function explorerAddressUrl(address: PublicKey | string): string {
  return `https://explorer.solana.com/address/${address.toString()}?cluster=devnet`;
}

export function explorerTxUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

export { canonicalJson } from '../canonical.js';

/** SHA-256 of the canonical rules JSON: the `rules_hash` stored on-chain with each challenge. */
export async function rulesHash(rules: unknown): Promise<number[]> {
  return Array.from(await sha256Bytes(canonicalJson(rules)));
}
