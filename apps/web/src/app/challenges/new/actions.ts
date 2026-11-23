'use server';

import { DEVNET_USDC_MINT, parseRepoList, rulesDocument, validateChallengeForm, WSOL_MINT } from '@codestreak/shared';
import { rulesHash } from '@codestreak/shared/program';
import { isSolanaAddress } from '@codestreak/shared/wallet';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { resolvePublicRepos } from '@/lib/github/repos';
import { prepareCreate, serverConnection, submitRelayed, type RelayResult } from '@/lib/relayer/service';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

const keySchema = z.uuid();

async function chainNow(): Promise<number> {
  const connection = serverConnection();
  const slot = await connection.getSlot('confirmed');
  return (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
}

/** A random challenge id below 2^53 (unique per creator; a collision would simply fail to create). */
function newChallengeId(): bigint {
  return randomBytes(8).readBigUInt64LE() & ((1n << 53n) - 1n);
}

export type CreateResult = RelayResult<{ transaction: string; challenge: string } | { signature: string; challenge: string }> & { fieldErrors?: Record<string, string> };

/**
 * Server half of the wizard: re-validates everything (form rules + the program's own checks at
 * chain time), then prepares a sponsored initialize_pool signed by the user's linked wallet.
 */
export async function prepareCreateAction(input: { form: unknown; wallet: string; idempotencyKey: string }): Promise<CreateResult> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in to create a challenge.' };
  if (!isSolanaAddress(input.wallet) || !keySchema.safeParse(input.idempotencyKey).success) return { ok: false, error: 'Invalid request.' };

  const supabase = await createSupabaseServerClient();
  const { data: wallet } = await supabase.from('wallets').select('id').eq('address', input.wallet).not('verified_at', 'is', null).maybeSingle();
  if (!wallet) return { ok: false, error: 'Use your linked wallet (Dashboard → Wallet).', code: 'wallet.not_linked', title: 'Wrong wallet' };

  const checked = validateChallengeForm(input.form, await chainNow());
  if (!checked.ok) return { ok: false, error: 'Some settings need fixing.', code: 'form.invalid', title: 'Check the form', fieldErrors: checked.errors };

  // "Only these repositories": resolve to ids now (public check), before the rules are hashed.
  const repoNames = checked.form.providers.includes('github') ? parseRepoList(checked.form.githubRepos) : { ok: true as const, repos: [] };
  if (!repoNames.ok) return { ok: false, error: repoNames.error, code: 'form.invalid', title: 'Check the form', fieldErrors: { githubRepos: repoNames.error } };
  const resolved = repoNames.repos.length ? await resolvePublicRepos(repoNames.repos) : { ok: true as const, repos: [] };
  if (!resolved.ok) return { ok: false, error: resolved.error, code: 'form.invalid', title: 'Check the repositories', fieldErrors: { githubRepos: resolved.error } };

  const rules = rulesDocument(checked.form, { repos: resolved.repos });
  return prepareCreate({
    profileId: viewer.userId,
    wallet: input.wallet,
    idempotencyKey: input.idempotencyKey,
    challengeId: newChallengeId(),
    params: checked.params,
    mint: checked.form.token === 'sol' ? WSOL_MINT : (process.env.NEXT_PUBLIC_USDC_MINT ?? DEVNET_USDC_MINT),
    rulesHash: await rulesHash(rules),
    details: {
      title: checked.form.title,
      description: checked.form.description,
      visibility: checked.form.visibility,
      rules, // exactly the document whose hash goes on-chain
    },
  });
}

export async function submitCreateAction(input: { idempotencyKey: string; signedTransaction: string }): Promise<RelayResult<{ signature: string }>> {
  const viewer = await getViewer();
  if (!viewer) return { ok: false, error: 'Sign in again.' };
  if (!keySchema.safeParse(input.idempotencyKey).success || input.signedTransaction.length > 4000) return { ok: false, error: 'Invalid request.' };
  return submitRelayed({ profileId: viewer.userId, idempotencyKey: input.idempotencyKey, signedTransaction: input.signedTransaction });
}
