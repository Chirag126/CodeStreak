import { formatAmount, shieldsEnabled, SOL_DECIMALS, USDC_DECIMALS } from '@codestreak/shared';
import { createProgram, participantPda, type ChallengeAccount, type ChallengeTimes } from '@codestreak/shared/program';
import { PublicKey } from '@solana/web3.js';
import { serverConnection } from '@/lib/relayer/service';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { ShieldCard } from './shield-card';

/** Chain time minus server time (seconds): countdowns follow the chain's clock, which decides. */
async function chainClockSkew(): Promise<number> {
  try {
    const connection = serverConnection();
    const t = await connection.getBlockTime(await connection.getSlot('confirmed'));
    return t === null ? 0 : t - Math.floor(Date.now() / 1000);
  } catch {
    return 0;
  }
}

/** Challenge page, for players while the challenge runs: Shield eligibility read from the chain. */
export async function ShieldPanel({ address, membershipId, account, times }: { address: string; membershipId: string; account: ChallengeAccount; times: ChallengeTimes }) {
  const price = BigInt(account.shieldPrice.toString());
  if (!shieldsEnabled({ maxShields: account.maxShieldsPerParticipant, shieldPrice: price }) || times.state !== 'open') return null;
  const supabase = await createSupabaseServerClient();
  const [{ data: member }, { data: results }, { data: checks }] = await Promise.all([
    supabase.from('memberships').select('wallet_address').eq('id', membershipId).maybeSingle(),
    supabase.from('day_results').select('day, result').eq('membership_id', membershipId),
    supabase.from('member_day_checks').select('day, outcome').eq('membership_id', membershipId),
  ]);
  // Latest "Check now" per day: met if any provider met the goal (the ANY rule).
  const met: Record<number, boolean> = {};
  for (const c of checks ?? []) if (c.outcome === 'met') met[c.day as number] = true;
  if (!member) return null;
  const wallet = member.wallet_address as string;
  const connection = serverConnection();
  const [p, skew] = await Promise.all([createProgram(connection).account.participant.fetchNullable(participantPda(new PublicKey(address), new PublicKey(wallet))), chainClockSkew()]);
  if (!p || p.finalized) return null;
  const isSol = account.mint.toBase58() === 'So11111111111111111111111111111111111111112';
  return (
    <ShieldCard
      address={address}
      wallet={wallet}
      isSol={isSol}
      priceLabel={`${formatAmount(price, isSol ? SOL_DECIMALS : USDC_DECIMALS)} ${isSol ? 'SOL' : 'USDC'}`}
      challenge={{
        state: times.state,
        startTs: times.startTs,
        dayLengthSecs: times.dayLengthSecs,
        numDays: times.numDays,
        shieldPrice: price.toString(),
        maxShields: account.maxShieldsPerParticipant,
        shieldGraceSecs: account.shieldGraceSecs,
      }}
      participant={{ finalized: p.finalized, shieldsUsed: p.shieldsUsed, shieldedDays: p.shieldedDays.toString(), verifiedDays: p.verifiedDays.toString() }}
      recorded={Object.fromEntries((results ?? []).map((r) => [r.day as number, r.result as 'verified' | 'failed' | 'indeterminate']))}
      checkedMet={met}
      clockSkewSecs={skew}
    />
  );
}
