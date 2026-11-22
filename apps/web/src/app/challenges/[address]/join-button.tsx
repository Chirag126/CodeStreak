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
export function JoinButton({ challenge, linkedWallets, buyInLabel }: { challenge: string; linkedWallets: string[]; buyInLabel: string }) {
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
      const prepared = await prepareJoinAction({ challenge, wallet: account.address, idempotencyKey });
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
  return (
    <div className="space-y-4">
      {wallets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Solana wallet found in this browser. Install Phantom and reload.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {wallets.map((w) => (
            <Button key={w.name} onClick={() => void join(w)} loading={busy} disabled={state.status === 'success'}>
              {state.status === 'error' ? 'Try again' : `Join with ${w.name}`} · {buyInLabel}
            </Button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">No SOL needed: CodeStreak pays the network fees. Your wallet only approves the buy-in.</p>
      <TxStepper state={state} />
    </div>
  );
}
