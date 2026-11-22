'use client';

import { DEVNET_USDC_MINT, formatAmount, SOL_DECIMALS, USDC_DECIMALS } from '@codestreak/shared';
import { Connection, PublicKey } from '@solana/web3.js';
import { useEffect, useState } from 'react';

export interface Balances {
  sol: string;
  usdc: string;
  hasSol: boolean;
  hasUsdc: boolean;
}

/** Devnet SOL and USDC balances of an address, read from the public RPC (no wallet needed). */
export function useBalances(address: string | null): { balances: Balances | null; error: string | null } {
  const [state, setState] = useState<{ key: string; balances: Balances | null; error: string | null } | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com', 'confirmed');
    const owner = new PublicKey(address);
    void Promise.all([
      connection.getBalance(owner),
      connection.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT ?? DEVNET_USDC_MINT) }),
    ])
      .then(([lamports, tokens]) => {
        const usdcUnits = tokens.value.reduce(
          (sum, t) => sum + BigInt((t.account.data.parsed as { info: { tokenAmount: { amount: string } } }).info.tokenAmount.amount),
          0n,
        );
        const balances: Balances = {
          sol: formatAmount(BigInt(lamports), SOL_DECIMALS),
          usdc: formatAmount(usdcUnits, USDC_DECIMALS),
          hasSol: lamports > 0,
          hasUsdc: usdcUnits > 0n,
        };
        if (!cancelled) setState({ key: address, balances, error: null });
      })
      .catch(() => !cancelled && setState({ key: address, balances: null, error: 'Could not load devnet balances.' }));
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (!address || state?.key !== address) return { balances: null, error: null };
  return { balances: state.balances, error: state.error };
}
