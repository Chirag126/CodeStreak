import { formatAmount, SOL_DECIMALS, USDC_DECIMALS, WSOL_MINT } from '@codestreak/shared';
import { challengePhase, challengeTimes, createProgram, explorerAddressUrl } from '@codestreak/shared/program';
import { isSolanaAddress } from '@codestreak/shared/wallet';
import { PublicKey } from '@solana/web3.js';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { serverConnection } from '@/lib/relayer/service';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';
import { JoinButton } from './join-button';

export const metadata: Metadata = { title: 'Challenge' };

/** The cluster's clock (falls back to this server's clock if the RPC has no block time). */
async function chainNow(connection: ReturnType<typeof serverConnection>): Promise<number> {
  const slot = await connection.getSlot('confirmed');
  return (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
}

const when = (ts: number) => new Date(ts * 1000).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

// Reads the challenge straight from devnet. The full challenge pages come in later phases.
export default async function ChallengePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isSolanaAddress(address)) notFound();
  const connection = serverConnection();
  const program = createProgram(connection);
  const account = await program.account.challenge.fetchNullable(new PublicKey(address)).catch(() => null);
  if (!account) notFound();

  const times = challengeTimes(account);
  const now = await chainNow(connection);
  const phase = challengePhase(times, now);
  const isSol = account.mint.toBase58() === WSOL_MINT;
  const buyIn = `${formatAmount(BigInt(account.buyIn.toString()), isSol ? SOL_DECIMALS : USDC_DECIMALS)} ${isSol ? 'SOL' : 'USDC'}`;

  const viewer = await getViewer();
  let linkedWallets: string[] = [];
  if (viewer) {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.from('wallets').select('address').not('verified_at', 'is', null);
    linkedWallets = (data ?? []).map((w) => w.address as string);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            {account.isDemo && <Badge variant="warning">DEMO · compressed time</Badge>}
            {account.joinAuthority && <Badge variant="accent">Private group</Badge>}
            <Badge variant="primary">{phase}</Badge>
          </div>
          <CardTitle className="text-2xl">Challenge {address.slice(0, 4)}…{address.slice(-4)}</CardTitle>
          <CardDescription>
            <a className="underline" href={explorerAddressUrl(address)} target="_blank" rel="noreferrer">
              View on Solana Explorer (devnet)
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-muted-foreground">Buy-in</dt><dd className="font-mono">{buyIn}</dd></div>
            <div><dt className="text-muted-foreground">Days</dt><dd>{account.numDays} × {account.dayLengthSecs >= 86400 ? '1 day' : `${account.dayLengthSecs / 60} min`}</dd></div>
            <div><dt className="text-muted-foreground">Participants</dt><dd>{account.participantCount} / {account.maxParticipants}</dd></div>
            <div><dt className="text-muted-foreground">Join until</dt><dd>{when(times.joinDeadlineTs)}</dd></div>
            <div><dt className="text-muted-foreground">Starts</dt><dd>{when(times.startTs)}</dd></div>
            <div><dt className="text-muted-foreground">In the vault</dt><dd className="font-mono">{formatAmount(BigInt(account.totalStake.toString()) + BigInt(account.totalSponsor.toString()), isSol ? SOL_DECIMALS : USDC_DECIMALS)}</dd></div>
          </dl>
          {phase !== 'joining' ? (
            <p className="text-sm text-muted-foreground">Joining is closed.</p>
          ) : !viewer ? (
            <a className="text-sm underline" href={`/sign-in?next=${encodeURIComponent(`/challenges/${address}`)}`}>
              Sign in to join
            </a>
          ) : (
            <JoinButton challenge={address} linkedWallets={linkedWallets} buyInLabel={buyIn} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
