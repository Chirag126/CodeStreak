import 'server-only';

import { computeBudgetInstructions, planComputeBudget, sendWithResend } from '@codestreak/shared/relayer';
import { Transaction, type Connection, type Keypair, type TransactionInstruction } from '@solana/web3.js';

/**
 * Phase 42 - a transaction only the server signs (e.g. creating a payout token account): tight
 * compute limit and current priority fee from a simulation, a fresh blockhash, then send and
 * re-send until it is confirmed or its blockhash expires. Throws the simulation's error if any.
 */
export async function sendServerTransaction(connection: Connection, signer: Keypair, instructions: TransactionInstruction[], cap = 200_000): Promise<string> {
  const plan = await planComputeBudget(connection, { payer: signer.publicKey, instructions, cap });
  if (plan.err) throw Object.assign(new Error(`Simulation failed: ${JSON.stringify(plan.err)}`), { logs: plan.logs ?? undefined });
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(...computeBudgetInstructions(plan.units, plan.microLamports), ...instructions);
  tx.sign(signer);
  return sendWithResend(connection, tx.serialize(), { lastValidBlockHeight });
}
