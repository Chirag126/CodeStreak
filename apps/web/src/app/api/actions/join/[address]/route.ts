import { joinActionMetadata, parseActionAccount } from '@codestreak/shared';
import { randomUUID } from 'node:crypto';
import { type NextRequest } from 'next/server';
import { loadActionChallenge, NO_ACCOUNT, NOT_PUBLIC, onchainRulesHash, profileForWallet } from '@/lib/actions/challenge';
import { actionError, actionJson, actionOptions, readJsonBody } from '@/lib/actions/http';
import { appOrigin } from '@/lib/app-origin';
import { nowSecs } from '@/lib/insights/load';
import { prepareJoin } from '@/lib/relayer/service';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ address: string }> };

/** Blink metadata: join a public challenge. */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { address } = await params;
  const c = await loadActionChallenge(address, nowSecs());
  if (!c) return actionError(NOT_PUBLIC, 404);
  const origin = appOrigin(req.nextUrl.origin);
  return actionJson(joinActionMetadata(c, origin, `${origin}/api/actions/icon/${address}.png`), 200, { 'Cache-Control': 'no-store' });
}

/**
 * Builds the join transaction for `account`. Every server check of the app applies (moderation,
 * linked coding accounts, balance, rules fingerprint, rate limit); the relayer pays the fees and
 * pre-signs as the entry-gate payer, so the wallet only adds its own signature.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { address } = await params;
  const parsed = parseActionAccount(await readJsonBody(req));
  if (!parsed.ok) return actionError(parsed.error);
  const c = await loadActionChallenge(address, nowSecs());
  if (!c) return actionError(NOT_PUBLIC, 404);
  if (!c.joinOpen) return actionError('Joining has closed for this challenge.');
  const profileId = await profileForWallet(parsed.account);
  if (!profileId) return actionError(NO_ACCOUNT, 403);

  // The Blink shows the rules link; prepareJoin still refuses if the saved rules don't hash to it.
  const key = randomUUID();
  try {
    const rulesHash = await onchainRulesHash(address);
    if (!rulesHash) return actionError('Challenge not found on devnet.', 404);
    const r = await prepareJoin({ profileId, wallet: parsed.account, challengeAddress: address, idempotencyKey: key, acknowledgedRulesHash: rulesHash });
    if (!r.ok) return actionError(r.error);
    if (!('transaction' in r)) return actionError('You already joined this challenge with this wallet.');
    return actionJson({
      type: 'transaction',
      transaction: r.transaction,
      message: `Join "${c.title}". CodeStreak pays the network fee; your wallet sends only the buy-in.`,
      links: { next: { type: 'post', href: `/api/actions/join/${address}/done?key=${key}` } },
    });
  } catch (e) {
    console.error('[actions] join failed:', e instanceof Error ? e.message : e);
    return actionError('Could not build the transaction. Try again in a moment.', 500);
  }
}

export const OPTIONS = actionOptions;
