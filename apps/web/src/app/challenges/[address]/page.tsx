import { checkableDay, describeDailyGoal, formatAmount, missingProviders, PROVIDER_LABELS, type Provider, GITHUB_OPTION_LIMITS, SOL_DECIMALS, survivalRate, USDC_DECIMALS, WSOL_MINT } from '@codestreak/shared';
import { challengePhase, challengeTimes, createProgram, explorerAddressUrl, rulesHash } from '@codestreak/shared/program';
import { isSolanaAddress } from '@codestreak/shared/wallet';
import { PublicKey } from '@solana/web3.js';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { after } from 'next/server';
import { percent, type Token } from '@/components/challenges/format';
import { RewardEstimate } from '@/components/challenges/reward-estimate';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { serverConnection } from '@/lib/relayer/service';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';
import { syncMembers } from '@/lib/sync/chain';
import { GroupBoard } from '@/components/board/group-board';
import { InvitePanel } from '@/components/groups/invite-panel';
import { SponsorDialog } from '@/components/sponsor/sponsor-dialog';
import { SponsorLeaderboard } from '@/components/sponsor/sponsor-leaderboard';
import { SponsorLinkPanel } from '@/components/sponsor/sponsor-link-panel';
import { listSponsors } from '@/lib/sponsor/load';
import { loadBoard } from '@/lib/board/load';
import { MyDayCard } from '@/components/checks/my-day-card';
import { readDayLogs } from '@/lib/verification/day-check';
import { listGroupInvites } from '@/lib/groups/invites';
import { JoinButton } from './join-button';

export const metadata: Metadata = { title: 'Challenge' };

/** The cluster's clock (falls back to this server's clock if the RPC has no block time). */
async function chainNow(connection: ReturnType<typeof serverConnection>): Promise<number> {
  const slot = await connection.getSlot('confirmed');
  return (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
}

const when = (ts: number) => new Date(ts * 1000).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC';

type GithubRulesDoc = {
  minMeaningfulLines?: number;
  fileFilter?: { extensions?: string[]; filenames?: string[] } | null;
  allow?: { docs?: boolean; generated?: boolean; forks?: boolean; backdateHours?: number } | null;
  repos?: { id: number; fullName: string }[] | null;
};
type LeetcodeRulesDoc = { minNewSolves?: number; minDifficulty?: 'any' | 'medium' | 'hard'; minAcceptedPerDay?: number };
type Rules = { providers?: string[]; providerRule?: 'any' | 'all'; github?: GithubRulesDoc | null; leetcode?: LeetcodeRulesDoc | null };

/** The creator's LeetCode options in plain words. */
function leetcodeOptionLines(l: LeetcodeRulesDoc | null | undefined): string[] {
  if (!l) return [];
  const diff = l.minDifficulty === 'hard' ? 'Hard' : l.minDifficulty === 'medium' ? 'Medium or Hard' : null;
  return [
    'LeetCode: your profile and its recent submissions must stay public. CodeStreak snapshots it at day start, every 30 minutes and when you check.',
    `A problem counts only if it is new for you: your solved count must go up and it must appear in your recent accepted submissions.${diff ? ` Only ${diff} problems count.` : ''}`,
    'Re-solving a problem you already solved, or a solve made before the day started, never counts. Hiding your profile fails the day.',
  ];
}

/** The creator's GitHub options in plain words (older challenges have none: strict). */
function githubOptionLines(g: GithubRulesDoc | null | undefined): string[] {
  if (!g) return [];
  const min = g.minMeaningfulLines ?? 15;
  const filter = [...(g.fileFilter?.extensions ?? []), ...(g.fileFilter?.filenames ?? [])];
  const repos = (g.repos ?? []).map((r) => r.fullName);
  const lines = [
    repos.length ? `Only your own pushes to ${repos.join(', ')} count.` : 'Only pushes to public repositories you own count (pushes to private repositories are never visible).',
    filter.length ? `Only these files count: ${filter.join(', ')}.` : 'Any source file counts (not docs, lockfiles, minified or generated files).',
    'Each commit must be written and pushed by you. Whitespace-only changes, moved lines, re-pushed changes and merges never count.',
  ];
  if (g.allow?.docs) lines.push(`README/docs count, up to ${Math.floor(min * GITHUB_OPTION_LIMITS.docsCapShare)} lines a day.`);
  if (g.allow?.generated) lines.push(`Lockfiles, minified and generated files count, up to ${Math.floor(min * GITHUB_OPTION_LIMITS.generatedCapShare)} lines a day.`);
  if (!repos.length) lines.push(g.allow?.forks ? 'Your own commits in your forks count.' : 'Forks don’t count.');
  lines.push(g.allow?.backdateHours ? `Commits made up to ${g.allow.backdateHours}h before a day starts still count for it.` : 'Commits must be made during the day they are pushed.');
  return lines;
}

const describeRules = (rules: Rules) => describeDailyGoal(rules);

/**
 * Challenge detail. Money and players are read live from devnet (the source of truth); app
 * details, stats and players come from the database mirror, refreshed after the response when it
 * is more than a minute old (joins can happen outside the app).
 */
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
  const token: Token = isSol ? 'sol' : 'usdc';
  const decimals = isSol ? SOL_DECIMALS : USDC_DECIMALS;
  const symbol = isSol ? 'SOL' : 'USDC';
  const fmt = (v: { toString(): string }) => `${formatAmount(BigInt(v.toString()), decimals)} ${symbol}`;
  const buyIn = fmt(account.buyIn);
  const pool = BigInt(account.totalStake.toString()) + BigInt(account.totalSponsor.toString()) + BigInt(account.totalShield.toString());

  const viewer = await getViewer();
  const supabase = await createSupabaseServerClient();
  // RLS: rows are visible only if the viewer may see this challenge.
  const { data: row } = await supabase.from('challenge_overview').select('*').eq('onchain_address', address).maybeSingle();
  // Private group the viewer may not see (RLS hid the row): show only that it exists. The account
  // itself is public on-chain, but the app never lists its details, players or rules to outsiders.
  if (account.joinAuthority && !row) return <PrivateNotice address={address} signedIn={Boolean(viewer)} />;

  const { data: standings } = row
    ? await supabase
        .from('challenge_standings')
        .select('membership_id, public_id, display_name, verified_days, failed_days, shields_used')
        .eq('challenge_id', row.id as string)
        .limit(100)
    : { data: [] };
  let linkedWallets: string[] = [];
  // What this viewer still has to link before they can join (the server checks again on join).
  let needToLink: string | null = null;
  if (viewer) {
    const [{ data }, { data: accounts }] = await Promise.all([
      supabase.from('wallets').select('address').not('verified_at', 'is', null),
      supabase.from('linked_accounts').select('provider').eq('profile_id', viewer.userId),
    ]);
    linkedWallets = (data ?? []).map((w) => w.address as string);
    const missing = missingProviders(row?.rules as Parameters<typeof missingProviders>[0], (accounts ?? []).map((a) => a.provider as Provider));
    if (!missing.ok) {
      const names = missing.need.map((p) => PROVIDER_LABELS[p]);
      needToLink =
        missing.need.length === 1
          ? `This challenge counts ${names[0]} activity. Link your ${names[0]} account in Dashboard → Settings, then come back to join.`
          : missing.rule === 'all'
            ? `This challenge counts both ${names.join(' and ')}. Link both in Dashboard → Settings, then come back to join.`
            : `This challenge counts ${names.join(' or ')}. Link at least one of them in Dashboard → Settings, then come back to join.`;
    }
  }

  const stale = !row || Date.parse(row.updated_at as string) < now * 1000 - 60_000;
  if (stale) {
    after(() => syncMembers(connection, address).then(() => undefined, (e: unknown) => console.error('[sync] challenge refresh failed:', e)));
  }

  const rate = row ? survivalRate({ members: Number(row.members), stillIn: Number(row.still_in), survived: Number(row.survived), finalized: Number(row.finalized) }) : null;
  const rulesText = describeRules((row?.rules ?? {}) as Rules);
  const githubLines = [...githubOptionLines(((row?.rules ?? {}) as Rules).github), ...leetcodeOptionLines(((row?.rules ?? {}) as Rules).leetcode)];
  const shieldsOn = account.maxShieldsPerParticipant > 0;
  const viewerJoined = Boolean(viewer && (standings ?? []).some((m) => m.public_id === viewer.publicId));
  const isCreator = Boolean(viewer && row && row.creator_id === viewer.userId);
  const invites = isCreator && row?.visibility === 'private' ? await listGroupInvites(viewer!.userId, row.id as string) : null;
  const short = Math.max(0, account.minParticipants - account.participantCount);
  const board = row ? await loadBoard(address) : null;
  const sponsors = row ? await listSponsors(row.id as string) : [];
  const sponsorOpen = phase === 'joining' || phase === 'starting' || phase === 'active';
  let sponsorLinkActive = false;
  if (isCreator && row?.visibility === 'private') {
    const { data } = await supabase.from('challenges').select('sponsor_link_created_at').eq('id', row.id as string).maybeSingle();
    sponsorLinkActive = Boolean(data?.sponsor_link_created_at);
  }
  const title = (row?.title as string | undefined) ?? `Challenge ${address.slice(0, 4)}…${address.slice(-4)}`;

  // A player's own day: the latest check per provider for the day that can be checked now.
  const myMembershipId = board?.viewer.membershipId ?? null;
  const slot = checkableDay(times, now);
  const countsSomething = Boolean(((row?.rules ?? {}) as Rules).github || ((row?.rules ?? {}) as Rules).leetcode);
  const myDay = myMembershipId && slot.ok && countsSomething ? { day: slot.day, logs: await readDayLogs(supabase, myMembershipId, slot.day) } : null;

  // Rules integrity: what CodeStreak shows must hash to the on-chain fingerprint.
  const onChainRulesHash = Buffer.from(account.rulesHash).toString('hex');
  const rulesVerified = Boolean(row?.rules) && Buffer.from(await rulesHash(row!.rules)).toString('hex') === onChainRulesHash;
  const dayLabel = account.dayLengthSecs >= 86400 ? '24 hours' : `${account.dayLengthSecs / 60} minutes`;
  const endTs = times.startTs + times.numDays * times.dayLengthSecs;
  const span = (secs: number) => (secs >= 3600 ? `${Math.round(secs / 3600)} h` : `${Math.round(secs / 60)} min`);
  const stakeTerms = [
    `Stake: ${buyIn}, locked in the challenge until it settles. CodeStreak pays the network fees.`,
    `Schedule: ${account.numDays} days of ${dayLabel}, ${when(times.startTs)} to ${when(endTs)}. Join by ${when(times.joinDeadlineTs)}.`,
    `Each day counts if you make ${rulesText || 'a verified coding contribution'}.`,
    ...githubLines,
    `Miss a day${shieldsOn ? ' without a Shield' : ''} and you lose your stake. It is shared by the players who keep their streak.`,
    'Keep your streak and you get your stake back plus an equal share of forfeited stakes, sponsorships and Shield payments. If nobody keeps it, everyone is refunded.',
    shieldsOn
      ? `Shields: up to ${account.maxShieldsPerParticipant} per player at ${fmt(account.shieldPrice)}, bought until ${Math.round(account.shieldGraceSecs / 60)} min after a missed day ends.`
      : 'Shields are off: a missed day cannot be covered.',
    `Fewer than ${account.minParticipants} players by the join deadline: the challenge is cancelled and everyone is refunded.`,
    'A day that cannot be checked (for example a GitHub or LeetCode outage) never fails you.',
    `Results are final ${span(times.verifyWindowSecs + times.disputeWindowSecs)} after the last day (checks, then a dispute window).`,
    'Your linked GitHub and LeetCode accounts cannot be changed or unlinked until the challenge ends.',
    ...(account.joinAuthority ? ['Private group: only invited people can see it and join.'] : []),
  ];

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-12 sm:px-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            {account.isDemo && <Badge variant="warning">DEMO · compressed time</Badge>}
            {account.joinAuthority && <Badge variant="accent">Private group</Badge>}
            <Badge variant={phase === 'cancelled' ? 'danger' : 'primary'}>{phase}</Badge>
            <Badge variant="outline">Live from devnet</Badge>
          </div>
          <CardTitle className="text-2xl">{(row?.title as string | undefined) ?? `Challenge ${address.slice(0, 4)}…${address.slice(-4)}`}</CardTitle>
          {row?.description && <p className="text-sm text-muted-foreground">{row.description as string}</p>}
          <CardDescription>
            <a className="underline" href={explorerAddressUrl(address)} target="_blank" rel="noreferrer">
              View on Solana Explorer (devnet)
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><dt className="text-muted-foreground">Buy-in</dt><dd className="font-mono">{buyIn}</dd></div>
            <div><dt className="text-muted-foreground">Pool</dt><dd className="font-mono">{fmt(pool)}</dd></div>
            <div><dt className="text-muted-foreground">Players</dt><dd>{account.participantCount} / {account.maxParticipants} (min {account.minParticipants})</dd></div>
            <div><dt className="text-muted-foreground">Surviving</dt><dd>{phase === 'cancelled' || phase === 'joining' || phase === 'starting' ? '–' : percent(rate)}</dd></div>
            <div><dt className="text-muted-foreground">Days</dt><dd>{account.numDays} × {account.dayLengthSecs >= 86400 ? '1 day' : `${account.dayLengthSecs / 60} min`}</dd></div>
            <div><dt className="text-muted-foreground">Join until</dt><dd>{when(times.joinDeadlineTs)}</dd></div>
            <div><dt className="text-muted-foreground">Starts</dt><dd>{when(times.startTs)}</dd></div>
            <div><dt className="text-muted-foreground">Sponsored</dt><dd className="font-mono">{fmt(account.totalSponsor)}</dd></div>
          </dl>
          {phase === 'joining' && (
            <p className="text-sm text-muted-foreground">
              {short > 0
                ? `${account.participantCount} of ${account.minParticipants} needed. It starts once ${short} more ${short === 1 ? 'player joins' : 'players join'} by ${when(times.joinDeadlineTs)}; otherwise everyone is refunded.`
                : `Minimum of ${account.minParticipants} reached: it starts ${when(times.startTs)}.`}
            </p>
          )}
          {phase === 'cancelled' ? (
            <p className="text-sm text-muted-foreground">Cancelled: fewer than {account.minParticipants} players joined, so every stake was refunded.</p>
          ) : phase !== 'joining' ? (
            <p className="text-sm text-muted-foreground">Joining is closed.</p>
          ) : viewerJoined ? (
            <p className="text-sm text-success">You are in this challenge.</p>
          ) : !viewer ? (
            <a className="text-sm underline" href={`/sign-in?next=${encodeURIComponent(`/challenges/${address}`)}`}>
              Sign in to join
            </a>
          ) : (
            <JoinButton challenge={address} linkedWallets={linkedWallets} buyInLabel={buyIn} isSol={isSol} needToLink={needToLink} terms={{ rulesHash: onChainRulesHash, verified: rulesVerified, items: stakeTerms }} />
          )}
        </CardContent>
      </Card>

      {invites && phase === 'joining' && <InvitePanel address={address} invites={invites} />}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Rules</CardTitle>
              {rulesVerified ? <Badge variant="success">Matches on-chain fingerprint</Badge> : <Badge variant="danger">Can&apos;t be verified</Badge>}
            </div>
            <CardDescription>
              {rulesVerified
                ? 'Their SHA-256 fingerprint is stored on-chain, so they can’t change after creation.'
                : 'The saved rules don’t match this challenge’s on-chain fingerprint (it was created outside the app), so joining is blocked.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <span className="text-muted-foreground">A day counts if you make </span>
              {rulesText || 'a verified coding contribution'}.
            </p>
            {githubLines.length > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {githubLines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
            <p>
              <span className="text-muted-foreground">Shields: </span>
              {shieldsOn
                ? `up to ${account.maxShieldsPerParticipant} per player at ${fmt(account.shieldPrice)}, until ${Math.round(account.shieldGraceSecs / 60)} min after a day ends. Shield payments join the reward pool.`
                : 'off.'}
            </p>
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="font-medium">Payout formula</p>
              <p className="mt-1 font-mono text-xs">R = forfeited stakes + sponsorships + Shield payments</p>
              <p className="font-mono text-xs">each survivor gets: stake + ⌊R ÷ survivors⌋</p>
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                <li>The remainder (a few base units) goes to the last survivor who claims.</li>
                <li>Nobody survives: everyone, sponsors included, is refunded in full.</li>
                <li>A day that can&apos;t be verified (provider outage) never fails you: your stake comes back.</li>
                <li>Fewer than {account.minParticipants} players by the deadline: cancelled and refunded.</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        {phase !== 'cancelled' && (
        <Card>
          <CardHeader>
            <CardTitle>Reward estimate</CardTitle>
            <CardDescription>The program&apos;s settlement formula, on this pool.</CardDescription>
          </CardHeader>
          <CardContent>
            <RewardEstimate
              token={token}
              buyIn={account.buyIn.toString()}
              participants={account.participantCount}
              totalSponsor={account.totalSponsor.toString()}
              totalShield={account.totalShield.toString()}
              includeViewer={phase === 'joining' && !viewerJoined}
              initialRate={rate === null ? 70 : Math.round((rate * 100) / 5) * 5}
            />
          </CardContent>
        </Card>
        )}
      </div>

      {myDay && <MyDayCard
          address={address}
          day={myDay.day}
          initial={myDay.logs}
          rule={((row?.rules ?? {}) as Rules).providerRule === 'all' ? 'all' : 'any'}
          providers={(['github', 'leetcode'] as const).filter((p) => Boolean(((row?.rules ?? {}) as Rules)[p]))}
        />}

      <SponsorLeaderboard
        sponsors={sponsors}
        decimals={decimals}
        symbol={symbol}
        totalSponsor={account.totalSponsor.toString()}
        action={
          !sponsorOpen ? (
            <span className="text-xs text-muted-foreground">Sponsorship closed</span>
          ) : viewer ? (
            <SponsorDialog challenge={address} token={token} linkedWallets={linkedWallets} title={title} />
          ) : (
            <a className="text-sm underline" href={`/sign-in?next=${encodeURIComponent(`/challenges/${address}`)}`}>
              Sign in to sponsor
            </a>
          )
        }
      />
      {isCreator && row?.visibility === 'private' && sponsorOpen && <SponsorLinkPanel challengeId={row.id as string} hasLink={sponsorLinkActive} />}

      {board ? (
        <GroupBoard address={address} initial={board} initialNow={now} decimals={decimals} symbol={symbol} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Group board</CardTitle>
            <CardDescription>{account.participantCount} joined on-chain · the board appears once this challenge is synced to the app.</CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}

function PrivateNotice({ address, signedIn }: { address: string; signedIn: boolean }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-16 sm:px-6">
      <Card>
        <CardHeader>
          <Badge variant="accent">Private group</Badge>
          <CardTitle className="text-2xl">This group is invite-only</CardTitle>
          <CardDescription>Only its members and invited friends can see it. Ask the creator for an invitation or an invite link.</CardDescription>
        </CardHeader>
        <CardContent>
          {!signedIn && (
            <a className="text-sm underline" href={`/sign-in?next=${encodeURIComponent(`/challenges/${address}`)}`}>
              Sign in if you were invited
            </a>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
