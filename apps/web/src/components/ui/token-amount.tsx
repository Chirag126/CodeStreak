import { formatAmount, SOL_DECIMALS, USDC_DECIMALS } from '@codestreak/shared';
import { cn } from '@/lib/utils';

const DECIMALS = { USDC: USDC_DECIMALS, SOL: SOL_DECIMALS } as const;

/** Exact token amount from integer base units (never floats). */
export function TokenAmount({ units, token, className, minFractionDigits = 2 }: { units: bigint; token: keyof typeof DECIMALS; className?: string; minFractionDigits?: number }) {
  return (
    <span className={cn('tabular-nums', className)}>
      {formatAmount(units, DECIMALS[token], minFractionDigits)}
      <span className="ml-1 text-[0.8em] font-medium text-muted-foreground">{token}</span>
    </span>
  );
}
