'use client';

import { formatAmount, SOL_DECIMALS, USDC_DECIMALS } from '@codestreak/shared';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { claimAction, prepareUnwrapAction, submitUnwrapAction } from '@/app/dashboard/claims/actions';
import { useToast } from '@/components/feedback/toaster';
import { AnimatedNumber, Stagger, StaggerItem } from '@/components/motion/primitives';
import { TxFlowError, useTxFlow } from '@/components/tx/tx-flow';
import { explorerTxUrl, TxStepper } from '@/components/tx/tx-stepper';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { connectWallet, DEVNET_CHAIN, useSolanaWallets } from '@/components/wallet/use-wallets';
import type { ClaimCenter as ClaimCenterData, ClaimRow, WrappedSolView } from '@/lib/claims/service';

type Token = 'sol' | 'usdc';
const DECIMALS: Record<Token, number> = { sol: SOL_DECIMALS, usdc: USDC_DECIMALS };
const SYMBOL: Record<Token, string> = { sol: 'SOL', usdc: 'USDC' };
const money = (units: string | bigint, token: Token) => `${formatAmount(BigInt(units), DECIMALS[token])} ${SYMBOL[token]}`;

// Stable formatters for the animated totals (display only: money stays bigint everywhere else).
const FORMAT: Record<Token, (n: number) => string> = {
  usdc: (n) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`,
  sol: (n) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} SOL`,
};
const toNumber = (units: bigint, token: Token) => Number(units) / 10 ** DECIMALS[token];

function totals(rows: ClaimRow[], pick: (r: ClaimRow) => boolean): Record<Token, bigint> {
  const out: Record<Token, bigint> = { sol: 0n, usdc: 0n };
  for (const r of rows) if (pick(r)) out[r.token] += BigInt(r.amount);
  return out;
}

const STATE_BADGE: Record<ClaimRow['state'], { label: string; variant: 'success' | 'accent' | 'warning' | 'outline' }> = {
  paid: { label: 'Paid', variant: 'success' },
  claimable: { label: 'Ready to claim', variant: 'accent' },
  not_settled: { label: 'Not settled yet', variant: 'outline' },
  not_finalized: { label: 'Finalizing', variant: 'warning' },
  already_paid: { label: 'Paid', variant: 'success' },
  nothing_owed: { label: 'Nothing to claim', variant: 'outline' },
};

export function ClaimCenter({ data }: { data: ClaimCenterData }) {
  const received = totals(data.rows, (r) => r.state === 'paid');
  const ready = totals(data.rows, (r) => r.state === 'claimable');
  const wrapped = data.wrapped.reduce((a, w) => a + BigInt(w.amount), 0n);
  const order: ClaimRow['state'][] = ['claimable', 'not_finalized', 'not_settled', 'paid', 'already_paid', 'nothing_owed'];
  const rows = [...data.rows].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state));

  return (
    <div className="space-y-8">
      <section aria-label="Totals" className="grid gap-4 sm:grid-cols-3">
        <TotalCard title="Received" hint="Paid to your wallets" amounts={received} />
        <TotalCard title="Ready to claim" hint="Sent automatically within minutes, or claim now" amounts={ready} highlight />
        <TotalCard title="Wrapped SOL" hint="SOL payouts arrive wrapped; unwrap below" amounts={{ sol: wrapped, usdc: 0n }} />
      </section>

      {data.wrapped.length > 0 && <UnwrapCard wrapped={data.wrapped} />}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Rewards and refunds from challenges you join or sponsor show up here. <Link className="underline underline-offset-4" href="/challenges">Browse challenges</Link>
        </p>
      ) : (
        <Stagger className="space-y-3">
          {rows.map((r) => (
            <StaggerItem key={`${r.role}:${r.challenge}`}>
              <ClaimRowCard row={r} />
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}

function TotalCard({ title, hint, amounts, highlight = false }: { title: string; hint: string; amounts: Record<Token, bigint>; highlight?: boolean }) {
  const tokens = (Object.keys(amounts) as Token[]).filter((t) => amounts[t] > 0n);
  return (
    <Card className={highlight ? 'border-cobalt-400/50' : undefined}>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="space-y-1 text-2xl tabular-nums">
          {tokens.length === 0 ? (
            <span className="text-muted-foreground">0</span>
          ) : (
            tokens.map((t) => (
              <AnimatedNumber key={t} value={toNumber(amounts[t], t)} format={FORMAT[t]} className="block" />
            ))
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>
    </Card>
  );
}

/** One payout: amount, state, line-by-line breakdown and (when ready) Claim now. Also used on challenge pages. */
export function ClaimRowCard({ row }: { row: ClaimRow }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const badge = STATE_BADGE[row.state];

  const claim = () =>
    startTransition(async () => {
      const result = await claimAction({ challenge: row.challenge, role: row.role });
      if (!result.ok) toast({ kind: 'error', title: result.title ?? 'Could not claim', message: result.error });
      else if ('alreadyPaid' in result) toast({ kind: 'success', title: 'Already paid', message: 'This payout was already sent to your wallet.' });
      else
        toast({
          kind: 'success',
          title: `Claimed ${money(result.amount, row.token)}`,
          message: row.token === 'sol' ? 'It arrived as wrapped SOL: unwrap it above to get plain SOL.' : 'Sent to your wallet. CodeStreak paid the fee.',
          href: explorerTxUrl(result.signature),
          hrefLabel: 'View on Explorer',
        });
      router.refresh();
    });

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <Link href={`/challenges/${row.challenge}`} className="block truncate font-medium hover:underline">
              {row.title}
            </Link>
            <p className="text-xs text-muted-foreground">
              {row.role === 'sponsor' ? 'Sponsor' : 'Player'} · {row.outcome}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold tabular-nums">{money(row.amount, row.token)}</span>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </div>
        </div>

        <details className="group rounded-md border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer select-none text-muted-foreground">Breakdown</summary>
          <dl className="mt-2 space-y-1">
            {row.lines.map((l) => (
              <div key={l.label} className="flex justify-between gap-4">
                <dt className={l.label.startsWith('·') ? 'pl-3 text-muted-foreground' : undefined}>
                  {l.label}
                  {l.note && <span className="ml-1 text-xs text-muted-foreground">({l.note})</span>}
                </dt>
                <dd className={`tabular-nums ${l.negative ? 'text-muted-foreground line-through' : ''}`}>{money(l.amount, row.token)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 border-t border-border pt-1 font-medium">
              <dt>{row.state === 'paid' ? 'You received' : 'Total'}</dt>
              <dd className="tabular-nums">{money(row.amount, row.token)}</dd>
            </div>
          </dl>
        </details>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          {row.state === 'claimable' && (
            <Button size="sm" onClick={claim} loading={pending} disabled={pending}>
              Claim now
            </Button>
          )}
          {row.state === 'paid' && row.paidTx && (
            <a className="underline underline-offset-4" href={explorerTxUrl(row.paidTx)} target="_blank" rel="noreferrer">
              View the payout on Explorer
            </a>
          )}
          {row.reason && <p className="text-muted-foreground">{row.reason}</p>}
          {row.state === 'not_settled' && row.settlesAt && (
            <p className="text-muted-foreground">Settles after {new Date(row.settlesAt * 1000).toLocaleString()}.</p>
          )}
          {row.state === 'claimable' && <p className="text-xs text-muted-foreground">Payouts are also sent automatically within a few minutes.</p>}
        </div>
      </CardContent>
    </Card>
  );
}

type SignTransactionFeature = {
  signTransaction(...inputs: { account: WalletAccount; transaction: Uint8Array; chain?: string }[]): Promise<{ signedTransaction: Uint8Array }[]>;
};
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toBase64 = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(''));

/** Unwrap: close your own wrapped SOL account into plain SOL. You approve; CodeStreak pays the fee. */
function UnwrapCard({ wrapped }: { wrapped: WrappedSolView[] }) {
  const wallets = useSolanaWallets().filter((w) => 'solana:signTransaction' in w.features);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Unwrap SOL</CardTitle>
        <CardDescription>
          SOL payouts arrive as Wrapped SOL (a token). Unwrapping turns it into plain SOL in the same wallet, and returns the small deposit the token
          account held. You approve once; CodeStreak pays the fee.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {wrapped.map((w) => (
          <UnwrapWallet key={w.wallet} item={w} wallets={wallets} />
        ))}
      </CardContent>
    </Card>
  );
}

function UnwrapWallet({ item, wallets }: { item: WrappedSolView; wallets: readonly Wallet[] }) {
  const router = useRouter();
  const toast = useToast();
  const { state, run } = useTxFlow();
  const [active, setActive] = useState<string | null>(null);
  const [idempotencyKey, setKey] = useState(() => crypto.randomUUID());

  const unwrap = useCallback(
    async (wallet: Wallet) => {
      setActive(wallet.name);
      const result = await run(async ({ step }) => {
        const account = await connectWallet(wallet);
        if (account.address !== item.wallet) {
          throw new TxFlowError({ code: 'wallet.mismatch', title: 'Wrong wallet', message: `Switch your wallet to ${item.wallet.slice(0, 4)}…${item.wallet.slice(-4)} and try again.` });
        }
        const prepared = await prepareUnwrapAction({ wallet: item.wallet, idempotencyKey });
        if (!prepared.ok) throw new TxFlowError({ code: prepared.code ?? 'relayer.refused', title: prepared.title ?? 'Could not unwrap', message: prepared.error });
        if ('signature' in prepared) return prepared.signature;
        step('sign');
        const feature = wallet.features['solana:signTransaction'] as SignTransactionFeature;
        const [out] = await feature.signTransaction({ account, transaction: fromBase64(prepared.transaction), chain: DEVNET_CHAIN });
        if (!out) throw new TxFlowError({ code: 'wallet.rejected', title: 'Cancelled in your wallet', message: 'The wallet returned no signature.' });
        step('confirm');
        const submitted = await submitUnwrapAction({ idempotencyKey, signedTransaction: toBase64(out.signedTransaction) });
        if (!submitted.ok) throw new TxFlowError({ code: submitted.code ?? 'relayer.refused', title: submitted.title ?? 'Could not unwrap', message: submitted.error });
        return submitted.signature;
      });
      if (result.ok) {
        toast({ kind: 'success', title: `Unwrapped ${money(item.amount, 'sol')}`, message: 'It is plain SOL in your wallet now.', href: explorerTxUrl(result.signature), hrefLabel: 'View on Explorer' });
        router.refresh();
      } else {
        toast({ kind: 'error', title: result.error.title, message: result.error.message });
        setKey(crypto.randomUUID()); // a fresh request for the next attempt
      }
    },
    [idempotencyKey, item, router, run, toast],
  );

  const busy = state.status === 'running';
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-sm">
        <span className="font-mono">{`${item.wallet.slice(0, 4)}…${item.wallet.slice(-4)}`}</span> holds <strong>{money(item.amount, 'sol')}</strong> wrapped
      </p>
      {wallets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Solana wallet found in this browser. Open this page where Phantom is installed.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {wallets.map((w) => (
            <Button key={w.name} size="sm" variant="secondary" onClick={() => void unwrap(w)} loading={busy && active === w.name} disabled={busy || state.status === 'success'}>
              Unwrap with {w.name}
            </Button>
          ))}
        </div>
      )}
      {state.status !== 'idle' && <TxStepper state={state} />}
    </div>
  );
}
