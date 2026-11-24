// Typed client for the CodeStreak Solana program (devnet). Import from "@codestreak/shared/program".
// The IDL is generated: run `node scripts/sync-idl.mjs` after changing the program.
export { anchor } from './anchor.js';
export * from './client.js';
export * from './errors.js';
export * from './lifecycle.js';
export * from './mirror.js';
export * from './pdas.js';
export { CODESTREAK_IDL, CODESTREAK_IDL_JSON } from './idl/codestreak.idl.js';
export type { Codestreak } from './idl/codestreak.types.js';
// Solana primitives for packages that only depend on @codestreak/shared (the worker).
export { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
