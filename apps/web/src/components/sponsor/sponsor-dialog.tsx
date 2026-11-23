'use client';

import { cleanSponsorMessage, parseSponsorAmount, SPONSOR_LIMITS, SPONSOR_MESSAGE_MAX, type SponsorToken } from '@codestreak/shared';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useToast } from '@/components/feedback/toaster';
import { TxFlowError, useTxFlow } from '@/components/tx/tx-flow';
import { explorerTxUrl, TxStepper } from '@/components/tx/tx-stepper';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { connectWallet, DEVNET_CHAIN, useSolanaWallets } from '@/components/wallet/use-wallets';
import { prepareSponsorAction, submitSponsorAction } from '@/app/challenges/[address]/sponsor-actions';
import { cn } from '@/lib/utils';

type SignTransactionFeature = {
  signTransaction(...inputs: { account: WalletAccount; transaction: Uint8Array; chain?: string }[]): Promise<{ signedTransaction: Uint8Array }[]>;
};
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toBase64 = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(''));

/**
 * Sponsor modal: choose an amount (presets or custom, validated with the same rules as the server),
 * an optional message, then Prepare → Approve → Confirm like a join. The relayer pays the fees.
 */
export function SponsorDialog({ challenge, token, linkedWallets, sponsorToken, title }: { challenge: string; token: SponsorToken; linkedWallets: string[]; sponsorToken?: string; title: string }) {
  const limits = SPONSOR_LIMITS[token];
  const router = useRouter();
  const toast = useToast();
  const wallets = useSolanaWallets().filter((w) => 'solana:signTransaction' in w.features);
  const { state, run, reset } = useTxFlow();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<string>(limits.presets[1]);
  const [message, setMessage] = useState('');
  const [touched, setTouched] = useState(false);
  // One key per attempt: a retry reuses it, so a sponsorship can never be sent twice.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const parsed = parseSponsorAmount(amount, token);
  const msg = cleanSponsorMessage(message);
  const amountError = touched && !parsed.ok ? parsed.error : null;
  const busy = state.status === 'running';
  const done = state.status === 'success';
  // Only the wallet in use shows a spinner; the others are just disabled.
  const [activeWallet, setActiveWallet] = useState<string | null>(null);

  function edit(update: () => void) {
    update();
    // A different amount or message is a new sponsorship: new key, fresh stepper.
    if (state.status !== 'running') {
      setIdempotencyKey(crypto.randomUUID());
      if (state.status !== 'idle') reset();
    }
  }

  async function sponsor(wallet: Wallet) {
    setTouched(true);
    if (!parsed.ok || !msg.ok) return;
    const result = await run(async ({ step }) => {
      const account = await connectWallet(wallet);
      if (!linkedWallets.includes(account.address)) {
        throw new TxFlowError({ code: 'wallet.not_linked', title: 'Wrong wallet', message: 'Switch to your linked wallet (Dashboard → Wallet) and try again.' });
      }
      const prepared = await prepareSponsorAction({ challenge, wallet: account.address, idempotencyKey, amount, message: msg.message ?? undefined, sponsorToken });
      if (!prepared.ok) throw new TxFlowError({ code: prepared.code ?? 'relayer.refused', title: prepared.title ?? 'Could not prepare the sponsorship', message: prepared.error });
      if ('signature' in prepared) return prepared.signature;

      step('sign');
      const feature = wallet.features['solana:signTransaction'] as SignTransactionFeature;
      const [out] = await feature.signTransaction({ account, transaction: fromBase64(prepared.transaction), chain: DEVNET_CHAIN });
      if (!out) throw new TxFlowError({ code: 'wallet.rejected', title: 'Cancelled in your wallet', message: 'The wallet returned no signature.' });

      step('confirm');
      const submitted = await submitSponsorAction({ idempotencyKey, signedTransaction: toBase64(out.signedTransaction) });
      if (!submitted.ok) throw new TxFlowError({ code: submitted.code ?? 'relayer.refused', title: submitted.title ?? 'The sponsorship did not go through', message: submitted.error });
      return submitted.signature;
    });
    if (result.ok) {
      toast({ kind: 'success', title: `You sponsored ${amount} ${limits.symbol}`, message: 'It is in the reward pool, with an on-chain receipt.', href: explorerTxUrl(result.signature), hrefLabel: 'View on Explorer' });
      router.refresh();
    } else {
      toast({ kind: 'error', title: result.error.title, message: result.error.message });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return; // don't lose a transaction in flight
        setOpen(o);
        if (!o && done) {
          reset();
          setIdempotencyKey(crypto.randomUUID());
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">Sponsor this challenge</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sponsor “{title}”</DialogTitle>
          <DialogDescription>Your {limits.symbol} goes into the reward pool and is shared by everyone who keeps their streak. If nobody does, or the challenge is cancelled, you can claim it back.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="sponsor-amount">Amount ({limits.symbol})</Label>
            <div className="flex flex-wrap gap-2">
              {limits.presets.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => edit(() => setAmount(p))}
                  disabled={busy}
                  className={cn('rounded-md border px-3 py-1.5 text-sm transition-colors', amount === p ? 'border-electric-400 bg-electric-400/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
                >
                  {p}
                </button>
              ))}
            </div>
            <Input
              id="sponsor-amount"
              inputMode="decimal"
              value={amount}
              disabled={busy}
              onChange={(e) => edit(() => setAmount(e.target.value))}
              onBlur={() => setTouched(true)}
              aria-invalid={Boolean(amountError) || undefined}
              aria-describedby="sponsor-amount-hint"
              className="font-mono"
            />
            <p id="sponsor-amount-hint" className={cn('text-xs', amountError ? 'text-destructive-text' : 'text-muted-foreground')} role={amountError ? 'alert' : undefined}>
              {amountError ?? `Between ${limits.min} and ${limits.max} ${limits.symbol}.`}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sponsor-message">Message (optional, shown with your sponsorship)</Label>
            <Input id="sponsor-message" value={message} maxLength={SPONSOR_MESSAGE_MAX + 20} disabled={busy} onChange={(e) => edit(() => setMessage(e.target.value))} placeholder="Keep shipping!" />
            {!msg.ok && <p className="text-xs text-destructive-text" role="alert">{msg.error}</p>}
          </div>

          {linkedWallets.length === 0 ? (
            <p className="text-sm text-muted-foreground">Link a wallet first (Dashboard → Wallet).</p>
          ) : wallets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Solana wallet found in this browser. Install Phantom and reload.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {wallets.map((w) => (
                <Button
                  key={w.name}
                  className="w-full"
                  onClick={() => {
                    setActiveWallet(w.name);
                    void sponsor(w);
                  }}
                  loading={busy && activeWallet === w.name}
                  disabled={busy || done || !parsed.ok || !msg.ok}
                >
                  {state.status === 'error' ? `Try again with ${w.name}` : `Sponsor with ${w.name}`}
                  {parsed.ok ? ` · ${amount.trim()} ${limits.symbol}` : ''}
                </Button>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            CodeStreak pays the network fees{token === 'sol' ? '; your SOL is wrapped in the same transaction' : ''}. Your wallet shows one approval.
          </p>
          <TxStepper state={state} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
