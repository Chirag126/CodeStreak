'use client';

import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useToast } from '@/components/feedback/toaster';
import { TxFlowError, useTxFlow } from '@/components/tx/tx-flow';
import { explorerTxUrl, TxStepper } from '@/components/tx/tx-stepper';
import { Button } from '@/components/ui/button';
import { connectWallet, DEVNET_CHAIN, useSolanaWallets } from '@/components/wallet/use-wallets';
import { prepareJoinAction, submitJoinAction } from './actions';

type SignTransactionFeature = {
  signTransaction(...inputs: { account: WalletAccount; transaction: Uint8Array; chain?: string }[]): Promise<{ signedTransaction: Uint8Array }[]>;
};

const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toBase64 = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(''));

/**
 * Sponsored join through the transaction kit: Prepare (server builds, checks, simulates and
 * pre-signs) → Approve (the wallet adds the user's signature) → Confirm (server verifies, sends,
 * waits for devnet). Every failure ends in a plain-language message.
 */
export interface StakeTerms {
  /** On-chain rules fingerprint (hex) the user agrees to; sent with the join and checked by the server. */
  rulesHash: string;
  /** Whether the rules shown hash to that fingerprint (otherwise joining is blocked). */
  verified: boolean;
  /** Everything a member should know before staking, in plain words. */
  items: string[];
}

export function JoinButton({ challenge, linkedWallets, buyInLabel, isSol = false, terms }: { challenge: string; linkedWallets: string[]; buyInLabel: string; isSol?: boolean; terms: StakeTerms }) {
  const [agreed, setAgreed] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const wallets = useSolanaWallets().filter((w) => 'solana:signTransaction' in w.features);
  const { state, run } = useTxFlow();
  // One idempotency key per join attempt: retries reuse it, so the join can never happen twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  async function join(wallet: Wallet) {
    const result = await run(async ({ step }) => {
      const account = await connectWallet(wallet);
      if (!linkedWallets.includes(account.address)) {
        throw new TxFlowError({ code: 'wallet.not_linked', title: 'Wrong wallet', message: 'Switch to your linked wallet (Dashboard → Wallet) and try again.' });
      }
      const prepared = await prepareJoinAction({ challenge, wallet: account.address, idempotencyKey, rulesHash: terms.rulesHash });
      if (!prepared.ok) throw new TxFlowError({ code: prepared.code ?? 'relayer.refused', title: prepared.title ?? 'Could not prepare the join', message: prepared.error });
      if ('signature' in prepared) return prepared.signature; // this attempt already went through

      step('sign');
      const feature = wallet.features['solana:signTransaction'] as SignTransactionFeature;
      const [out] = await feature.signTransaction({ account, transaction: fromBase64(prepared.transaction), chain: DEVNET_CHAIN });
      if (!out) throw new TxFlowError({ code: 'wallet.rejected', title: 'Cancelled in your wallet', message: 'The wallet returned no signature.' });

      step('confirm');
      const submitted = await submitJoinAction({ idempotencyKey, signedTransaction: toBase64(out.signedTransaction) });
      if (!submitted.ok) throw new TxFlowError({ code: submitted.code ?? 'relayer.refused', title: submitted.title ?? 'The join did not go through', message: submitted.error });
      return submitted.signature;
    });

    if (result.ok) {
      toast({ kind: 'success', title: 'You joined the challenge', message: 'CodeStreak paid the network fees.', href: explorerTxUrl(result.signature), hrefLabel: 'View on Explorer' });
      router.refresh();
    } else {
      toast({ kind: 'error', title: result.error.title, message: result.error.message });
    }
  }

  if (linkedWallets.length === 0) {
    return <p className="text-sm text-muted-foreground">Link a wallet first (Dashboard → Wallet).</p>;
  }
  const busy = state.status === 'running';
  if (!terms.verified) {
    return (
      <p role="alert" className="text-sm text-destructive-text">
        The rules saved for this challenge don&apos;t match its on-chain fingerprint, so you can&apos;t see what you would agree to. Joining is blocked.
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <section aria-labelledby="before-you-stake" className="space-y-3 rounded-lg border border-border p-4">
        <h3 id="before-you-stake" className="text-sm font-semibold">
          Before you stake
        </h3>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          {terms.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--color-cobalt-400)]"
            checked={agreed}
            disabled={busy || state.status === 'success'}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          <span>
            I&apos;ve read these rules and I understand I lose my {buyInLabel} stake if I miss a day without a Shield.
          </span>
        </label>
        <p className="font-mono text-[11px] text-muted-foreground">Rules fingerprint (on-chain): {terms.rulesHash.slice(0, 16)}…</p>
      </section>
      {wallets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Solana wallet found in this browser. Install Phantom and reload.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {wallets.map((w) => (
            <Button key={w.name} onClick={() => void join(w)} loading={busy} disabled={state.status === 'success' || !agreed} title={agreed ? undefined : 'Read the rules above and tick "I understand" first.'}>
              {state.status === 'error' ? `Try again with ${w.name}` : `Join with ${w.name}`} · {buyInLabel}
            </Button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {isSol
          ? 'CodeStreak pays the network fees. Your SOL is wrapped for the stake in the same transaction; your wallet shows one approval.'
          : 'No SOL needed: CodeStreak pays the network fees. Your wallet only approves the buy-in.'}
      </p>
      <TxStepper state={state} />
    </div>
  );
}
