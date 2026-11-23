'use server';

import { isSolanaAddress } from '@codestreak/shared/wallet';
import { z } from 'zod';
import { prepareJoin, submitRelayed, type RelayResult } from '@/lib/relayer/service';
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
