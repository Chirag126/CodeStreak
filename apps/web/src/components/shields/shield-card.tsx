'use client';

import { formatCountdown, SHIELD_BLOCK_TEXT, shieldableDays, type ShieldChallenge, type ShieldParticipant } from '@codestreak/shared';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { prepareShieldAction, submitShieldAction } from '@/app/challenges/[address]/actions';
import { useToast } from '@/components/feedback/toaster';
import { TxFlowError, useTxFlow } from '@/components/tx/tx-flow';
import { explorerTxUrl, TxStepper } from '@/components/tx/tx-stepper';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { connectWallet, DEVNET_CHAIN, useSolanaWallets } from '@/components/wallet/use-wallets';

type SignTransactionFeature = {
  signTransaction(...inputs: { account: WalletAccount; transaction: Uint8Array; chain?: string }[]): Promise<{ signedTransaction: Uint8Array }[]>;
};
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toBase64 = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(''));

/** Serializable props (bigints as strings) from the server. */
export interface ShieldCardProps {
  address: string;
  wallet: string;
  priceLabel: string;
  isSol: boolean;
  challenge: Omit<ShieldChallenge, 'shieldPrice'> & { shieldPrice: string };
  participant: Omit<ShieldParticipant, 'shieldedDays' | 'verifiedDays'> & { shieldedDays: string; verifiedDays: string };
  /** Day results recorded so far, by day (to say "recorded as failed" in the grace). */
  recorded: Record<number, 'verified' | 'failed' | 'indeterminate'>;
  /** Chain time minus browser time when the page was rendered (countdowns follow the chain's clock). */
  clockSkewSecs: number;
}

/** Ticking chain time (seconds), started after mount so render stays pure. */
function useChainNow(skew: number): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Math.floor(Date.now() / 1000) + skew);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [skew]);
  return now;
}

export function ShieldCard(props: ShieldCardProps) {
  const challenge = useMemo<ShieldChallenge>(() => ({ ...props.challenge, shieldPrice: BigInt(props.challenge.shieldPrice) }), [props.challenge]);
  const participant = useMemo<ShieldParticipant>(
    () => ({ ...props.participant, shieldedDays: BigInt(props.participant.shieldedDays), verifiedDays: BigInt(props.participant.verifiedDays) }),
    [props.participant],
  );
  const now = useChainNow(props.clockSkewSecs);
  const left = Math.max(0, challenge.maxShields - participant.shieldsUsed);
  const days = now === null ? [] : shieldableDays(challenge, participant, now);
  const protectedDays = Array.from({ length: challenge.numDays }, (_, d) => d).filter((d) => (participant.shieldedDays >> BigInt(d)) & 1n);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          Shields
          <Badge variant={left > 0 ? 'accent' : 'outline'}>
            {left} of {challenge.maxShields} left
          </Badge>
        </CardTitle>
        <CardDescription>
          A Shield protects one day for {props.priceLabel}: that day counts as kept even if you miss it. Buy it during the day, or within{' '}
          {formatCountdown(challenge.shieldGraceSecs)} after it ends to rescue a missed day. Shield payments go into the reward pool.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {protectedDays.length > 0 && <p className="text-sm">Protected: {protectedDays.map((d) => `day ${d + 1}`).join(', ')}.</p>}
        {now !== null && days.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {left === 0 ? SHIELD_BLOCK_TEXT.limit_reached : 'No day can be shielded right now. A day can be shielded once it starts, until its grace period ends.'}
          </p>
        )}
        {days.map((d) => (
          <ShieldDayRow key={d.day} {...props} day={d.day} block={d.block} closesIn={d.closesAt - (now ?? 0)} endsIn={d.dayEndsAt - (now ?? 0)} inGrace={d.inGrace} dayResult={props.recorded[d.day]} />
        ))}
      </CardContent>
    </Card>
  );
}

function ShieldDayRow({
  address,
  wallet,
  priceLabel,
  isSol,
  day,
  block,
  closesIn,
  endsIn,
  inGrace,
  dayResult,
}: ShieldCardProps & { day: number; block: ReturnType<typeof shieldableDays>[number]['block']; closesIn: number; endsIn: number; inGrace: boolean; dayResult?: string }) {
  const router = useRouter();
  const toast = useToast();
  const wallets = useSolanaWallets().filter((w) => 'solana:signTransaction' in w.features);
  const { state, run } = useTxFlow();
  const [active, setActive] = useState<string | null>(null);
  // One request key per day: a retry reuses it, so the same Shield is never bought twice.
  const [idempotencyKey, setKey] = useState(() => crypto.randomUUID());
  const busy = state.status === 'running';
  const urgent = closesIn <= 120;

  async function shield(w: Wallet) {
    setActive(w.name);
    const result = await run(async ({ step }) => {
      const account = await connectWallet(w);
      if (account.address !== wallet) {
        throw new TxFlowError({ code: 'wallet.mismatch', title: 'Wrong wallet', message: `Switch your wallet to ${wallet.slice(0, 4)}…${wallet.slice(-4)} (the one you joined with).` });
      }
      const prepared = await prepareShieldAction({ challenge: address, wallet, day, idempotencyKey });
      if (!prepared.ok) throw new TxFlowError({ code: prepared.code ?? 'relayer.refused', title: prepared.title ?? 'Could not prepare the Shield', message: prepared.error });
      if ('signature' in prepared) return prepared.signature;
      step('sign');
      const feature = w.features['solana:signTransaction'] as SignTransactionFeature;
      const [out] = await feature.signTransaction({ account, transaction: fromBase64(prepared.transaction), chain: DEVNET_CHAIN });
      if (!out) throw new TxFlowError({ code: 'wallet.rejected', title: 'Cancelled in your wallet', message: 'The wallet returned no signature.' });
      step('confirm');
      const submitted = await submitShieldAction({ challenge: address, idempotencyKey, signedTransaction: toBase64(out.signedTransaction) });
      if (!submitted.ok) throw new TxFlowError({ code: submitted.code ?? 'relayer.refused', title: submitted.title ?? 'The Shield did not go through', message: submitted.error });
      return submitted.signature;
    });
    if (result.ok) {
      toast({ kind: 'success', title: `Day ${day + 1} is protected`, message: 'CodeStreak paid the network fee.', href: explorerTxUrl(result.signature), hrefLabel: 'View on Explorer' });
      router.refresh();
    } else {
      toast({ kind: 'error', title: result.error.title, message: result.error.message });
      setKey(crypto.randomUUID());
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="font-medium">
          Day {day + 1}{' '}
          <span className="font-normal text-muted-foreground">
            {inGrace ? `ended · ${dayResult === 'failed' ? 'recorded as missed' : dayResult === 'indeterminate' ? "couldn't be verified" : 'result not recorded yet'}` : `today · ends in ${formatCountdown(endsIn)}`}
          </span>
        </p>
        {block === null ? (
          <span role="timer" aria-live="off" className={`tabular-nums text-xs ${urgent ? 'font-semibold text-warning-400' : 'text-muted-foreground'}`}>
            {inGrace ? 'Grace ends in' : 'Shield closes in'} {formatCountdown(closesIn)}
          </span>
        ) : (
          <Badge variant="outline">{block === 'already_shielded' ? 'Protected' : block === 'already_verified' ? 'Verified' : 'Unavailable'}</Badge>
        )}
      </div>
      {block !== null ? (
        <p className="text-xs text-muted-foreground">{SHIELD_BLOCK_TEXT[block]}</p>
      ) : wallets.length === 0 ? (
        <p className="text-xs text-muted-foreground">No Solana wallet found in this browser. Install Phantom and reload.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {wallets.map((w) => (
            <Button key={w.name} size="sm" variant={inGrace ? undefined : 'secondary'} onClick={() => void shield(w)} loading={busy && active === w.name} disabled={busy || state.status === 'success'}>
              Shield day {day + 1} with {w.name} · {priceLabel}
            </Button>
          ))}
        </div>
      )}
      {block === null && <p className="text-xs text-muted-foreground">{isSol ? 'Your SOL is wrapped for the payment in the same transaction.' : 'Paid from your USDC; CodeStreak pays the fee.'}</p>}
      {state.status !== 'idle' && <TxStepper state={state} />}
    </div>
  );
}
