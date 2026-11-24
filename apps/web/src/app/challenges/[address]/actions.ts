'use server';

import { isSolanaAddress } from '@codestreak/shared/wallet';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prepareJoin, prepareShield, submitRelayed, type RelayResult } from '@/lib/relayer/service';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

const keySchema = z.uuid();

/** The user's linked wallet that matches `address` (joins only from a verified, linked wallet). */
async function linkedWallet(address: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('wallets').select('id').eq('address', address).not('verified_at', 'is', null).maybeSingle();
  return Boolean(data);
}

export async function prepareJoinAction(input: { challenge: string; wallet: string; idempotencyKey: string; rulesHash: string }): Promise<RelayResult<{ transaction: string } | { signature: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in to join.' };
  if (!isSolanaAddress(input.challenge) || !isSolanaAddress(input.wallet) || !keySchema.safeParse(input.idempotencyKey).success) {
    return { ok: false, error: 'Invalid request.' };
  }
  if (!/^[0-9a-f]{64}$/.test(String(input.rulesHash))) {
    return { ok: false, code: 'rules.not_accepted', title: 'Accept the rules first', error: 'Read the rules and tick "I understand" before staking.' };
  }
  if (!(await linkedWallet(input.wallet))) return { ok: false, error: 'Link this wallet first (Dashboard → Wallet).' };
  return prepareJoin({ profileId: viewer.userId, wallet: input.wallet, challengeAddress: input.challenge, idempotencyKey: input.idempotencyKey, acknowledgedRulesHash: input.rulesHash });
}

export async function submitJoinAction(input: { idempotencyKey: string; signedTransaction: string }): Promise<RelayResult<{ signature: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  if (!keySchema.safeParse(input.idempotencyKey).success || input.signedTransaction.length > 4000) return { ok: false, error: 'Invalid request.' };
  return submitRelayed({ profileId: viewer.userId, idempotencyKey: input.idempotencyKey, signedTransaction: input.signedTransaction });
}

/** Shield one day (Phase 32): only from the viewer's own linked wallet; the server re-checks eligibility on-chain. */
export async function prepareShieldAction(input: { challenge: string; wallet: string; day: number; idempotencyKey: string }): Promise<RelayResult<{ transaction: string } | { signature: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in to use a Shield.' };
  if (!isSolanaAddress(input.challenge) || !isSolanaAddress(input.wallet) || !keySchema.safeParse(input.idempotencyKey).success || !Number.isInteger(input.day) || input.day < 0 || input.day > 59) {
    return { ok: false, error: 'Invalid request.' };
  }
  if (!(await linkedWallet(input.wallet))) return { ok: false, error: 'Use the wallet you joined with (Dashboard → Wallet).' };
  return prepareShield({ profileId: viewer.userId, wallet: input.wallet, challengeAddress: input.challenge, idempotencyKey: input.idempotencyKey, day: input.day });
}

export async function submitShieldAction(input: { challenge: string; idempotencyKey: string; signedTransaction: string }): Promise<RelayResult<{ signature: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  if (!isSolanaAddress(input.challenge) || !keySchema.safeParse(input.idempotencyKey).success || input.signedTransaction.length > 4000) return { ok: false, error: 'Invalid request.' };
  const result = await submitRelayed({ profileId: viewer.userId, idempotencyKey: input.idempotencyKey, signedTransaction: input.signedTransaction });
  revalidatePath(`/challenges/${input.challenge}`);
  return result;
}
