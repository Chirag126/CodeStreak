import { challengeStatus, formatAmount, SOL_DECIMALS, USDC_DECIMALS } from '@codestreak/shared';
import type { Metadata } from 'next';
import { SponsorDialog } from '@/components/sponsor/sponsor-dialog';
import { SponsorLeaderboard } from '@/components/sponsor/sponsor-leaderboard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { hashSponsorToken } from '@/lib/relayer/service';
import { listSponsors } from '@/lib/sponsor/load';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Sponsor a challenge', robots: { index: false, follow: false } };

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Clock for status checks (module level keeps render pure). */
const nowMs = () => Date.now();

/**
 * Private sponsor link: shows only what a sponsor needs (title, pool, players count, sponsors),
 * never the members, and lets them sponsor. The relayer re-checks the link when preparing.
 */
export default async function SponsorPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createSupabaseAdminClient();
  const { data: c } = TOKEN_RE.test(token)
    ? await admin
        .from('challenges')
        .select('id, title, token, onchain_address, pool_state, join_deadline_at, start_at, day_length_secs, num_days, buy_in, participant_count, total_stake, total_sponsor, total_shield')
        .eq('sponsor_link_hash', hashSponsorToken(token))
        .maybeSingle()
    : { data: null };

  if (!c || !c.onchain_address) {
    return (
      <div className="mx-auto flex max-w-xl flex-col px-4 py-16 sm:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Sponsor link unavailable</CardTitle>
            <CardDescription>This link is not valid or was turned off by the group. Ask them for a new one.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const isSol = c.token === 'sol';
  const decimals = isSol ? SOL_DECIMALS : USDC_DECIMALS;
  const symbol = isSol ? 'SOL' : 'USDC';
  const startMs = Date.parse(c.start_at as string);
  const status = challengeStatus(
    { poolState: c.pool_state as 'open' | 'cancelled' | 'settled', joinDeadlineMs: Date.parse(c.join_deadline_at as string), startMs, endMs: startMs + (c.num_days as number) * (c.day_length_secs as number) * 1000 },
    nowMs(),
  );
  const open = status === 'joining' || status === 'starting' || status === 'running';
  const pool = BigInt(String(c.total_stake)) + BigInt(String(c.total_sponsor)) + BigInt(String(c.total_shield));
  const sponsors = await listSponsors(c.id as string, false);

  const viewer = await getViewer();
  let linkedWallets: string[] = [];
  if (viewer) {
    const { data } = await (await createSupabaseServerClient()).from('wallets').select('address').not('verified_at', 'is', null);
    linkedWallets = (data ?? []).map((w) => w.address as string);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-2">
            <Badge variant="accent">Private group</Badge>
            <Badge variant="primary">{status}</Badge>
          </div>
          <CardTitle className="text-2xl">{c.title as string}</CardTitle>
          <CardDescription>You were given this group&apos;s sponsor link. Sponsors add to the reward pool; members and their progress stay private.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-muted-foreground">Pool</dt><dd className="font-mono">{formatAmount(pool, decimals)} {symbol}</dd></div>
            <div><dt className="text-muted-foreground">Players</dt><dd>{c.participant_count as number}</dd></div>
            <div><dt className="text-muted-foreground">Buy-in</dt><dd className="font-mono">{formatAmount(BigInt(String(c.buy_in)), decimals)} {symbol}</dd></div>
          </dl>
          {!open ? (
            <p className="text-sm text-muted-foreground">Sponsorship is closed for this challenge.</p>
          ) : viewer ? (
            <SponsorDialog challenge={c.onchain_address as string} token={isSol ? 'sol' : 'usdc'} linkedWallets={linkedWallets} sponsorToken={token} title={c.title as string} />
          ) : (
            <a className="text-sm underline" href={`/sign-in?next=${encodeURIComponent(`/sponsor/${token}`)}`}>
              Sign in to sponsor
            </a>
          )}
        </CardContent>
      </Card>
      <SponsorLeaderboard sponsors={sponsors} decimals={decimals} symbol={symbol} totalSponsor={String(c.total_sponsor)} />
    </div>
  );
}
