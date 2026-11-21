'use server';

import { addressProblem, buildBindingMessage, checkBinding, NONCE_TTL_SECONDS } from '@codestreak/shared/wallet';
import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getViewer } from '@/lib/supabase/server';

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

function walletKind(name: string): 'phantom' | 'metamask' | 'other' {
  const n = name.toLowerCase();
  return n.includes('phantom') ? 'phantom' : n.includes('metamask') ? 'metamask' : 'other';
}

async function appDomain(): Promise<string> {
  const appUrl = process.env.APP_URL?.trim();
  if (appUrl) return new URL(appUrl).host;
  return (await headers()).get('host') ?? 'localhost:3000';
}

/** Step 1: a single-use message for this user and address to sign (valid 5 minutes). */
export async function requestWalletChallenge(address: string): Promise<Result<{ message: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  const problem = addressProblem(address);
  if (problem) return { ok: false, error: problem };

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + NONCE_TTL_SECONDS * 1000);
  const nonce = randomBytes(16).toString('hex');
  const message = buildBindingMessage({ domain: await appDomain(), address, publicId: viewer.publicId, nonce, issuedAt, expiresAt });

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('wallet_nonces').insert({
    profile_id: viewer.userId,
    address,
    nonce,
    message,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
  });
  if (error) return { ok: false, error: 'Could not start linking. Please try again.' };
  return { ok: true, message };
}

/**
 * Step 2: verify the wallet's signature over that message and bind the wallet. The nonce is
 * consumed by a conditional update (`used_at is null`), so a replayed signature finds nothing.
 */
export async function linkWallet(input: { address: string; message: string; signature: string; walletName: string }): Promise<Result<object>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  const problem = addressProblem(input.address);
  if (problem) return { ok: false, error: problem };

  const admin = createSupabaseAdminClient();
  const nonce = /^Nonce: ([0-9a-f]{32})$/m.exec(input.message)?.[1];
  if (!nonce) return { ok: false, error: 'The signed message was changed.' };
  const { data: row } = await admin
    .from('wallet_nonces')
    .select('id, address, message, expires_at, used_at')
    .eq('nonce', nonce)
    .eq('profile_id', viewer.userId)
    .maybeSingle();
  if (!row) return { ok: false, error: 'This request was not found. Start again.' };

  const signature = Uint8Array.from(Buffer.from(input.signature, 'base64'));
  const check = checkBinding({
    record: { address: row.address as string, message: row.message as string, expiresAt: new Date(row.expires_at as string), usedAt: row.used_at ? new Date(row.used_at as string) : null },
    address: input.address,
    signedMessage: input.message,
    signature,
    now: new Date(),
  });
  if (!check.ok) return { ok: false, error: check.message };

  // Consume the nonce atomically: only the first request gets a row back.
  const { data: consumed } = await admin
    .from('wallet_nonces')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id');
  if (!consumed?.length) return { ok: false, error: 'This signature was already used. Start again.' };

  const { data: existing } = await admin.from('wallets').select('id, profile_id').eq('address', input.address).maybeSingle();
  if (existing && existing.profile_id !== viewer.userId) {
    return { ok: false, error: 'This wallet is already linked to another CodeStreak account.' };
  }
  if (existing) {
    await admin.from('wallets').update({ verified_at: new Date().toISOString() }).eq('id', existing.id);
  } else {
    const { count } = await admin.from('wallets').select('id', { count: 'exact', head: true }).eq('profile_id', viewer.userId);
    const { error } = await admin.from('wallets').insert({
      profile_id: viewer.userId,
      address: input.address,
      kind: walletKind(input.walletName),
      is_primary: !count,
      verified_at: new Date().toISOString(),
    });
    // The unique constraint settles races: one wallet can never end up on two accounts.
    if (error?.code === '23505') return { ok: false, error: 'This wallet is already linked to another CodeStreak account.' };
    if (error) return { ok: false, error: 'Could not link the wallet. Please try again.' };
  }

  await admin.from('audit_log').insert({
    actor_kind: 'user',
    actor_id: viewer.userId,
    action: 'wallet.link',
    entity_type: 'wallet',
    entity_id: input.address,
    details: { wallet: input.walletName },
  });
  revalidatePath('/dashboard/wallet');
  return { ok: true };
}

/** Removes one of the user's own wallets (re-linking needs a new signature). */
export async function unlinkWallet(walletId: string): Promise<Result<object>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from('wallets').delete().eq('id', walletId).eq('profile_id', viewer.userId).select('address');
  if (error || !data?.length) return { ok: false, error: 'Could not unlink that wallet.' };
  await admin.from('audit_log').insert({
    actor_kind: 'user',
    actor_id: viewer.userId,
    action: 'wallet.unlink',
    entity_type: 'wallet',
    entity_id: data[0]!.address as string,
  });
  revalidatePath('/dashboard/wallet');
  return { ok: true };
}
