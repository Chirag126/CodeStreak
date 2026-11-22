'use client';

import type { Wallet } from '@wallet-standard/base';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { connectWallet, signText, useSolanaWallets } from '@/components/wallet/use-wallets';
import { finishWalletLogin, startWalletLogin } from './wallet-actions';

const toBase64 = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(''));

/**
 * Sign in with a wallet already linked to a CodeStreak account: the server issues a one-time
 * message, the wallet signs it (no transaction, no fees), and the server signs this browser in.
 */
export function WalletSignIn({ next }: { next: string }) {
  const wallets = useSolanaWallets();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  function signIn(wallet: Wallet) {
    setError(null);
    start(async () => {
      let account;
      try {
        setStatus(`Connecting ${wallet.name}…`);
        account = await connectWallet(wallet);
      } catch {
        setStatus(null);
        return setError('The wallet did not connect.');
      }
      if (account.address.startsWith('0x')) {
        setStatus(null);
        return setError('That is an Ethereum (0x) account. In MetaMask, switch to your Solana account, or use Phantom.');
      }
      const challenge = await startWalletLogin(account.address);
      if (!challenge.ok) {
        setStatus(null);
        return setError(challenge.error);
      }
      let signature: Uint8Array;
      try {
        setStatus('Approve the sign-in message in your wallet…');
        signature = await signText(wallet, account, challenge.message);
      } catch {
        setStatus(null);
        return setError('Signing was cancelled in the wallet.');
      }
      setStatus('Signing you in…');
      const result = await finishWalletLogin({ address: account.address, nonce: challenge.nonce, signature: toBase64(signature), next });
      if (!result.ok) {
        setStatus(null);
        return setError(result.error);
      }
      // Full navigation so the server sees the new session cookies (and routes to username if needed).
      window.location.assign(result.next);
    });
  }

  if (wallets.length === 0) return null;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or, if you linked a wallet
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className="flex flex-col gap-2">
        {wallets.map((w) => (
          <Button key={w.name} variant="secondary" onClick={() => signIn(w)} loading={busy} className="w-full">
            Sign in with {w.name}
          </Button>
        ))}
      </div>
      {status && !error && (
        <p className="text-xs text-muted-foreground" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive-text" role="alert">
          {error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">Free: your wallet signs a one-time message, no transaction. Works only for wallets linked in Dashboard → Wallet.</p>
    </div>
  );
}
