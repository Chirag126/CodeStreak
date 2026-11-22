'use server';

import { cleanSponsorMessage } from '@codestreak/shared';
import { isSolanaAddress } from '@codestreak/shared/wallet';
import { randomBytes } from 'node:crypto';
import { headers } from 'next/headers';
import { z } from 'zod';
import { hashSponsorToken, prepareSponsor, submitRelayed, type RelayResult } from '@/lib/relayer/service';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

const keySchema = z.uuid();
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

async function linkedWallet(address: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('wallets').select('id').eq('address', address).not('verified_at', 'is', null).maybeSingle();
  return Boolean(data);
}

export async function prepareSponsorAction(input: {
  challenge: string;
  wallet: string;
  idempotencyKey: string;
  amount: string;
  message?: string;
  sponsorToken?: string;
}): Promise<RelayResult<{ transaction: string } | { signature: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in to sponsor.' };
  if (!isSolanaAddress(input.challenge) || !isSolanaAddress(input.wallet) || !keySchema.safeParse(input.idempotencyKey).success) return { ok: false, error: 'Invalid request.' };
  if (input.sponsorToken !== undefined && !tokenSchema.safeParse(input.sponsorToken).success) return { ok: false, error: 'This sponsor link is not valid.' };
  const message = cleanSponsorMessage(input.message);
  if (!message.ok) return { ok: false, error: message.error, code: 'sponsor.message', title: 'Check the message' };
  if (!(await linkedWallet(input.wallet))) return { ok: false, error: 'Link this wallet first (Dashboard → Wallet).' };
  return prepareSponsor({
    profileId: viewer.userId,
    wallet: input.wallet,
    challengeAddress: input.challenge,
    idempotencyKey: input.idempotencyKey,
    amount: String(input.amount).slice(0, 40),
    message: message.message,
    sponsorToken: input.sponsorToken,
  });
}

export async function submitSponsorAction(input: { idempotencyKey: string; signedTransaction: string }): Promise<RelayResult<{ signature: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  if (!keySchema.safeParse(input.idempotencyKey).success || input.signedTransaction.length > 4000) return { ok: false, error: 'Invalid request.' };
  return submitRelayed({ profileId: viewer.userId, idempotencyKey: input.idempotencyKey, signedTransaction: input.signedTransaction });
}

/**
 * Creator: makes (or replaces) the group's sponsor link. The token is returned once; only its
 * SHA-256 is stored, so the previous link stops working immediately.
 */
export async function createSponsorLinkAction(challengeId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  const token = randomBytes(32).toString('base64url');
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('challenges')
    .update({ sponsor_link_hash: hashSponsorToken(token), sponsor_link_created_at: new Date().toISOString() })
    .eq('id', String(challengeId))
    .eq('creator_id', viewer.userId)
    .select('id');
  if (error || !data?.length) return { ok: false, error: 'Only the creator can make a sponsor link.' };
  await admin.from('audit_log').insert({ actor_kind: 'user', actor_id: viewer.userId, action: 'sponsor.link_create', entity_type: 'challenge', entity_id: String(challengeId) });
  const origin = process.env.APP_URL?.trim() || (await headers()).get('origin') || 'http://localhost:3000';
  return { ok: true, url: `${origin.replace(/\/$/, '')}/sponsor/${token}` };
}

export async function revokeSponsorLinkAction(challengeId: string): Promise<{ ok: boolean; error?: string }> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  const { data } = await createSupabaseAdminClient()
    .from('challenges')
    .update({ sponsor_link_hash: null, sponsor_link_created_at: null })
    .eq('id', String(challengeId))
    .eq('creator_id', viewer.userId)
    .select('id');
  return data?.length ? { ok: true } : { ok: false, error: 'Only the creator can turn off the sponsor link.' };
}
