import { looksLikeAddress } from '@codestreak/shared';
import { type NextRequest } from 'next/server';
import { profileForWallet } from '@/lib/actions/challenge';
import { actionError, actionJson, actionOptions, readJsonBody } from '@/lib/actions/http';
import { appOrigin } from '@/lib/app-origin';
import { confirmExternalRelayed } from '@/lib/relayer/service';
import { ACTION_WRITE, overLimit } from '@/lib/http/rate-limit';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Blink callback (links.next) after the wallet's transaction confirmed: verifies it is exactly the
 * prepared one, records it in CodeStreak right away, and ends the chain with a "completed" card.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  const wait = overLimit(req, ACTION_WRITE);
  if (wait) return actionError(`Too many requests. Try again in ${wait} s.`, 429);
  const { address } = await params;
  const key = req.nextUrl.searchParams.get('key') ?? '';
  const body = ((await readJsonBody(req)) ?? {}) as { account?: unknown; signature?: unknown };
  const { account, signature } = body;
  if (!looksLikeAddress(address) || !UUID.test(key) || !looksLikeAddress(account) || typeof signature !== 'string' || signature.length > 100) return actionError('Malformed callback.');
  const profileId = await profileForWallet(account);
  if (!profileId) return actionError('This wallet is not linked to a CodeStreak account.', 403);
  const r = await confirmExternalRelayed({ profileId, idempotencyKey: key, signature });
  if (!r.ok) return actionError(r.error);
  const origin = appOrigin(req.nextUrl.origin);
  return actionJson({
    type: 'completed',
    icon: `${origin}/api/actions/icon/${address}.png`,
    title: 'Thank you for sponsoring',
    label: 'Done',
    description: 'Your sponsorship is in the reward pool. It goes to the players who keep their streak, or back to you if nobody does.',
  });
}

export const OPTIONS = actionOptions;
