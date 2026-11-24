'use server';

import { isSolanaAddress } from '@codestreak/shared/wallet';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { claimNow, prepareUnwrap, type ClaimRole } from '@/lib/claims/service';
import { submitRelayed, type RelayResult } from '@/lib/relayer/service';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

const keySchema = z.uuid();

/** Claims the signed-in user's own payout (the server sends it; no wallet signature is needed). */
export async function claimAction(input: { challenge: string; role: ClaimRole }): Promise<RelayResult<{ signature: string; amount: string } | { alreadyPaid: true }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in to claim.' };
  if (!isSolanaAddress(input.challenge) || (input.role !== 'player' && input.role !== 'sponsor')) return { ok: false, error: 'Invalid request.' };
  const result = await claimNow({ profileId: viewer.userId, challengeAddress: input.challenge, role: input.role });
  revalidatePath('/dashboard/claims');
  revalidatePath(`/challenges/${input.challenge}`);
  return result;
}

/** Unwrapping: only from one of the user's own verified wallets. */
export async function prepareUnwrapAction(input: { wallet: string; idempotencyKey: string }): Promise<RelayResult<{ transaction: string } | { signature: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  if (!isSolanaAddress(input.wallet) || !keySchema.safeParse(input.idempotencyKey).success) return { ok: false, error: 'Invalid request.' };
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('wallets').select('id').eq('address', input.wallet).eq('profile_id', viewer.userId).not('verified_at', 'is', null).maybeSingle();
  if (!data) return { ok: false, error: 'Unwrap from one of your own linked wallets (Dashboard → Wallet).' };
  return prepareUnwrap({ profileId: viewer.userId, wallet: input.wallet, idempotencyKey: input.idempotencyKey });
}

export async function submitUnwrapAction(input: { idempotencyKey: string; signedTransaction: string }): Promise<RelayResult<{ signature: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  if (!keySchema.safeParse(input.idempotencyKey).success || input.signedTransaction.length > 4000) return { ok: false, error: 'Invalid request.' };
  const result = await submitRelayed({ profileId: viewer.userId, idempotencyKey: input.idempotencyKey, signedTransaction: input.signedTransaction });
  revalidatePath('/dashboard/claims');
  return result;
}
