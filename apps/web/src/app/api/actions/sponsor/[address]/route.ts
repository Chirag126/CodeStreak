import { parseActionAccount, parseActionAmount, sponsorActionMetadata } from '@codestreak/shared';
import { randomUUID } from 'node:crypto';
import { type NextRequest } from 'next/server';
import { loadActionChallenge, NO_ACCOUNT, NOT_PUBLIC, profileForWallet } from '@/lib/actions/challenge';
import { actionError, actionJson, actionOptions, readJsonBody } from '@/lib/actions/http';
import { appOrigin } from '@/lib/app-origin';
import { nowSecs } from '@/lib/insights/load';
import { prepareSponsor } from '@/lib/relayer/service';
import { ACTION_WRITE, PUBLIC_READ, overLimit } from '@/lib/http/rate-limit';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ address: string }> };

/** Blink metadata: sponsor a public challenge (preset amounts and a custom one). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const wait = overLimit(req, PUBLIC_READ);
  if (wait) return actionError(`Too many requests. Try again in ${wait} s.`, 429);
  const { address } = await params;
  const c = await loadActionChallenge(address, nowSecs());
  if (!c) return actionError(NOT_PUBLIC, 404);
  const origin = appOrigin(req.nextUrl.origin);
  return actionJson(sponsorActionMetadata(c, `${origin}/api/actions/icon/${address}.png`), 200, { 'Cache-Control': 'no-store' });
}

/** Builds the sponsorship transaction. A missing, malformed or out-of-range amount is an ActionError. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const wait = overLimit(req, ACTION_WRITE);
  if (wait) return actionError(`Too many requests. Try again in ${wait} s.`, 429);
  const { address } = await params;
  const parsed = parseActionAccount(await readJsonBody(req));
  if (!parsed.ok) return actionError(parsed.error);
  const c = await loadActionChallenge(address, nowSecs());
  if (!c) return actionError(NOT_PUBLIC, 404);
  const amount = parseActionAmount(req.nextUrl.searchParams.get('amount'), c.token);
  if (!amount.ok) return actionError(amount.error);
  if (!c.sponsorOpen) return actionError('Sponsoring closes when the challenge ends.');
  const profileId = await profileForWallet(parsed.account);
  if (!profileId) return actionError(NO_ACCOUNT, 403);

  const key = randomUUID();
  try {
    const r = await prepareSponsor({ profileId, wallet: parsed.account, challengeAddress: address, idempotencyKey: key, amount: req.nextUrl.searchParams.get('amount')!, message: null });
    if (!r.ok) return actionError(r.error);
    if (!('transaction' in r)) return actionError('This sponsorship was already sent.');
    return actionJson({
      type: 'transaction',
      transaction: r.transaction,
      message: `Sponsor "${c.title}". CodeStreak pays the network fee.`,
      links: { next: { type: 'post', href: `/api/actions/sponsor/${address}/done?key=${key}` } },
    });
  } catch (e) {
    console.error('[actions] sponsor failed:', e instanceof Error ? e.message : e);
    return actionError('Could not build the transaction. Try again in a moment.', 500);
  }
}

export const OPTIONS = actionOptions;
