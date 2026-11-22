import { formatAmount, SOL_DECIMALS, USDC_DECIMALS } from '@codestreak/shared';

export type Token = 'usdc' | 'sol';

/** Database numerics arrive as numbers or strings; money is always handled as bigint. */
export function units(value: unknown): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  return BigInt(typeof value === 'number' ? Math.trunc(value).toString() : String(value).split('.')[0]!);
}

export function money(value: unknown, token: Token): string {
  const decimals = token === 'sol' ? SOL_DECIMALS : USDC_DECIMALS;
  const text = formatAmount(units(value), decimals);
  const [whole, frac = ''] = text.split('.');
  return `${whole}${frac ? `.${frac.slice(0, token === 'sol' ? 4 : 2)}` : ''} ${token === 'sol' ? 'SOL' : 'USDC'}`;
}

export function lengthLabel(numDays: number, dayLengthSecs: number): string {
  return dayLengthSecs >= 86_400 ? `${numDays} days` : `${numDays} × ${Math.round(dayLengthSecs / 60)} min`;
}

export function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

export function relativeTime(target: Date, now: Date): string {
  const diff = target.getTime() - now.getTime();
  const abs = Math.abs(diff);
  const unit = abs >= 86_400_000 ? ['day', 86_400_000] : abs >= 3_600_000 ? ['hour', 3_600_000] : ['minute', 60_000];
  const n = Math.max(1, Math.round(abs / (unit[1] as number)));
  const label = `${n} ${unit[0]}${n === 1 ? '' : 's'}`;
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}
