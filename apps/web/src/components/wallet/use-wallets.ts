'use client';

import { getWallets } from '@wallet-standard/app';
import type { Wallet, WalletAccount } from '@wallet-standard/base';
import { useEffect, useState } from 'react';

/** Wallet Standard features CodeStreak needs (named by string to avoid extra type packages). */
export const CONNECT = 'standard:connect';
export const SIGN_MESSAGE = 'solana:signMessage';
export const DEVNET_CHAIN = 'solana:devnet';

type ConnectFeature = { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }> };
type SignMessageFeature = {
  signMessage(...inputs: { account: WalletAccount; message: Uint8Array }[]): Promise<{ signedMessage: Uint8Array; signature: Uint8Array }[]>;
};

/** Solana wallets that can connect and sign messages (Phantom, MetaMask's Solana account, ...). */
export function isUsableSolanaWallet(wallet: Wallet): boolean {
  return wallet.chains.some((c) => c.startsWith('solana:')) && CONNECT in wallet.features && SIGN_MESSAGE in wallet.features;
}

/** Live list of installed wallets, via the Wallet Standard registry (no wallet-specific code). */
export function useSolanaWallets(): readonly Wallet[] {
  const [wallets, setWallets] = useState<readonly Wallet[]>([]);
  useEffect(() => {
    const registry = getWallets();
    const refresh = () => setWallets(registry.get().filter(isUsableSolanaWallet));
    refresh();
    const offRegister = registry.on('register', refresh);
    const offUnregister = registry.on('unregister', refresh);
    return () => {
      offRegister();
      offUnregister();
    };
  }, []);
  return wallets;
}

export async function connectWallet(wallet: Wallet): Promise<WalletAccount> {
  const feature = wallet.features[CONNECT] as ConnectFeature;
  const { accounts } = await feature.connect();
  const account = accounts.find((a) => a.chains.some((c) => c.startsWith('solana:'))) ?? accounts[0];
  if (!account) throw new Error('The wallet did not share an account.');
  return account;
}

export async function signText(wallet: Wallet, account: WalletAccount, text: string): Promise<Uint8Array> {
  const feature = wallet.features[SIGN_MESSAGE] as SignMessageFeature;
  const [output] = await feature.signMessage({ account, message: new TextEncoder().encode(text) });
  if (!output) throw new Error('The wallet returned no signature.');
  return output.signature;
}

/** Whether the wallet says it supports Solana devnet (needed later to stake; signing works regardless). */
export function supportsDevnet(wallet: Wallet, account?: WalletAccount): boolean {
  return wallet.chains.includes(DEVNET_CHAIN) || Boolean(account?.chains.includes(DEVNET_CHAIN));
}
