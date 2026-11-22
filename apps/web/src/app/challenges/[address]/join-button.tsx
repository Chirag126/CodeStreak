'use client';

import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { connectWallet, DEVNET_CHAIN, useSolanaWallets } from '@/components/wallet/use-wallets';
import { prepareJoinAction, submitJoinAction } from './actions';

type SignTransactionFeature = {
  signTransaction(...inputs: { account: WalletAccount; transaction: Uint8Array; chain?: string }[]): Promise<{ signedTransaction: Uint8Array }[]>;
};

const explorerTxUrl = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toBase64 = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(''));

/**
 * Sponsored join: the server builds and pre-signs the transaction (CodeStreak pays the fees), the
 * wallet adds the user's signature, and the server checks it is unchanged before sending it.
 */
export function JoinButton({ challenge, linkedWallets, buyInLabel }: { challenge: string; linkedWallets: string[]; buyInLabel: string }) {
  const router = useRouter();
  const wallets = useSolanaWallets().filter((w) => 'solana:signTransaction' in w.features);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string; signature?: string } | null>(null);
  const [busy, startTransition] = useTransition();
  // One idempotency key per join attempt: retries reuse it, so the join can never happen twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  function join(wallet: Wallet) {
    setMessage(null);
    startTransition(async () => {
      let account: WalletAccount;
      try {
        account = await connectWallet(wallet);
      } catch {
        return setMessage({ kind: 'error', text: 'Could not connect the wallet.' });
      }
      if (!linkedWallets.includes(account.address)) {
        return setMessage({ kind: 'error', text: 'Switch to your linked wallet (Dashboard → Wallet) and try again.' });
      }
      const prepared = await prepareJoinAction({ challenge, wallet: account.address, idempotencyKey });
      if (!prepared.ok) return setMessage({ kind: 'error', text: prepared.error });
      if ('signature' in prepared) return setMessage({ kind: 'success', text: 'You already joined.', signature: prepared.signature });

      let signed: Uint8Array;
      try {
        const feature = wallet.features['solana:signTransaction'] as SignTransactionFeature;
        const [out] = await feature.signTransaction({ account, transaction: fromBase64(prepared.transaction), chain: DEVNET_CHAIN });
        if (!out) throw new Error('no signature');
        signed = out.signedTransaction;
      } catch {
        return setMessage({ kind: 'error', text: 'Signing was cancelled in the wallet.' });
      }
      const result = await submitJoinAction({ idempotencyKey, signedTransaction: toBase64(signed) });
      if (!result.ok) return setMessage({ kind: 'error', text: result.error });
      setMessage({ kind: 'success', text: 'Joined! CodeStreak paid the network fees.', signature: result.signature });
      router.refresh();
    });
  }

  if (linkedWallets.length === 0) {
    return <p className="text-sm text-muted-foreground">Link a wallet first (Dashboard → Wallet).</p>;
  }
  return (
    <div className="space-y-3">
      {wallets.length === 0 ? (
        <p className="text-sm text-muted-foreground">No Solana wallet found in this browser. Install Phantom and reload.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {wallets.map((w) => (
            <Button key={w.name} onClick={() => join(w)} loading={busy}>
              Join with {w.name} · {buyInLabel}
            </Button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">No SOL needed: CodeStreak pays the network fees. Your wallet only approves the buy-in.</p>
      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={message.kind === 'error' ? 'text-sm text-destructive-text' : 'text-sm text-success'}>
          {message.text}{' '}
          {message.signature && (
            <a className="underline" href={explorerTxUrl(message.signature)} target="_blank" rel="noreferrer">
              View on Explorer
            </a>
          )}
        </p>
      )}
    </div>
  );
}
