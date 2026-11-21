'use client';

import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { CheckCircle2, CircleAlert, Wallet as WalletIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { linkWallet, requestWalletChallenge, unlinkWallet } from '@/app/dashboard/wallet/actions';
import { DevnetChecklist } from './devnet-checklist';
import { useBalances } from './use-balances';
import { connectWallet, signText, supportsDevnet, useSolanaWallets } from './use-wallets';

export interface LinkedWallet {
  id: string;
  address: string;
  kind: string;
  isPrimary: boolean;
  verifiedAt: string | null;
}

function short(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function WalletPanel({ linked }: { linked: LinkedWallet[] }) {
  const router = useRouter();
  const wallets = useSolanaWallets();
  const [connected, setConnected] = useState<{ wallet: Wallet; account: WalletAccount } | null>(null);
  const [status, setStatus] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [busy, startTransition] = useTransition();

  const primary = linked.find((w) => w.isPrimary) ?? linked[0] ?? null;
  const shownAddress = connected?.account.address ?? primary?.address ?? null;
  const { balances, error: balanceError } = useBalances(shownAddress);
  const isLinked = (address: string) => linked.some((w) => w.address === address);

  function connect(wallet: Wallet) {
    setStatus(null);
    startTransition(async () => {
      try {
        const account = await connectWallet(wallet);
        if (account.address.startsWith('0x')) {
          setStatus({ kind: 'error', text: 'That is an Ethereum (0x) account. In MetaMask, switch to your Solana account, or use Phantom.' });
          return;
        }
        setConnected({ wallet, account });
      } catch (e) {
        setStatus({ kind: 'error', text: e instanceof Error ? e.message : 'Could not connect.' });
      }
    });
  }

  function link() {
    if (!connected) return;
    const { wallet, account } = connected;
    setStatus(null);
    startTransition(async () => {
      const challenge = await requestWalletChallenge(account.address);
      if (!challenge.ok) return setStatus({ kind: 'error', text: challenge.error });
      let signature: Uint8Array;
      try {
        signature = await signText(wallet, account, challenge.message);
      } catch {
        return setStatus({ kind: 'error', text: 'Signing was cancelled in the wallet.' });
      }
      const result = await linkWallet({ address: account.address, message: challenge.message, signature: toBase64(signature), walletName: wallet.name });
      if (!result.ok) return setStatus({ kind: 'error', text: result.error });
      setStatus({ kind: 'success', text: `${wallet.name} wallet ${short(account.address)} is linked to your account.` });
      router.refresh();
    });
  }

  function unlink(id: string) {
    startTransition(async () => {
      const result = await unlinkWallet(id);
      setStatus(result.ok ? { kind: 'success', text: 'Wallet unlinked.' } : { kind: 'error', text: result.error });
      router.refresh();
    });
  }

  const devnetOk = connected ? supportsDevnet(connected.wallet, connected.account) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Connect a wallet</CardTitle>
            <CardDescription>Phantom is recommended on devnet. MetaMask works for linking with its Solana account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {wallets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No Solana wallet found in this browser. Install{' '}
                <a className="underline" href="https://phantom.com/download" target="_blank" rel="noreferrer">
                  Phantom
                </a>{' '}
                and reload.
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {wallets.map((w) => (
                  <li key={w.name}>
                    <Button variant="secondary" className="w-full justify-start" onClick={() => connect(w)} disabled={busy}>
                      {/* eslint-disable-next-line @next/next/no-img-element -- wallet icons are data URIs */}
                      <img src={w.icon} alt="" className="size-5 rounded" />
                      {w.name}
                      {connected?.wallet.name === w.name && <Badge className="ml-auto">Connected</Badge>}
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {connected && (
              <div className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">{short(connected.account.address)}</span>
                  {devnetOk ? (
                    <Badge variant="success">Devnet ready</Badge>
                  ) : (
                    <Badge variant="warning">Devnet not reported: use Phantom to stake</Badge>
                  )}
                  {isLinked(connected.account.address) && <Badge variant="primary">Linked</Badge>}
                </div>
                {!isLinked(connected.account.address) && (
                  <Button onClick={link} loading={busy}>
                    Link this wallet (sign a message, free)
                  </Button>
                )}
              </div>
            )}

            {status && (
              <p role={status.kind === 'error' ? 'alert' : 'status'} className={status.kind === 'error' ? 'text-sm text-destructive-text' : 'text-sm text-success'}>
                {status.text}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Linked wallets</CardTitle>
            <CardDescription>Stakes and payouts use your linked wallets only.</CardDescription>
          </CardHeader>
          <CardContent>
            {linked.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {linked.map((w) => (
                  <li key={w.id} className="flex items-center gap-3 py-3">
                    <WalletIcon className="size-4 text-muted-foreground" aria-hidden />
                    <span className="font-mono text-sm">{short(w.address)}</span>
                    <Badge variant="outline">{w.kind}</Badge>
                    {w.isPrimary && <Badge variant="primary">Primary</Badge>}
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => unlink(w.id)} disabled={busy}>
                      Unlink
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Balances <Badge variant="primary">Devnet</Badge>
            </CardTitle>
            <CardDescription>{shownAddress ? short(shownAddress) : 'Connect or link a wallet.'}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {balanceError ? (
              <p className="flex items-center gap-2 text-sm text-destructive-text">
                <CircleAlert className="size-4" aria-hidden /> {balanceError}
              </p>
            ) : (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">SOL</dt>
                <dd className="text-right font-mono">{balances ? balances.sol : '—'}</dd>
                <dt className="text-muted-foreground">USDC</dt>
                <dd className="text-right font-mono">{balances ? balances.usdc : '—'}</dd>
              </dl>
            )}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3.5" aria-hidden /> Devnet test tokens have no real value.
            </p>
          </CardContent>
        </Card>
        <DevnetChecklist
          walletFound={wallets.length > 0}
          walletLinked={linked.length > 0}
          devnetReady={devnetOk}
          hasSol={balances?.hasSol ?? false}
          hasUsdc={balances?.hasUsdc ?? false}
        />
      </div>
    </div>
  );
}
