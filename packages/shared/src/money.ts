// Money is always an integer number of base units (bigint). Never floats.
//   1 USDC = 1_000_000 base units (6 decimals); 1 SOL = 1_000_000_000 lamports (9 decimals).

const AMOUNT_RE = /^\d+(\.\d+)?$/;

/** Parses a user-typed decimal string into base units. "12.5" with 6 decimals -> 12_500_000n. */
export function parseAmount(input: string, decimals: number): bigint {
  const s = input.trim();
  if (!AMOUNT_RE.test(s)) throw new Error(`Invalid amount "${input}": use digits and an optional decimal point`);
  const [whole = '0', frac = ''] = s.split('.');
  if (frac.length > decimals) throw new Error(`Invalid amount "${input}": at most ${decimals} decimal places`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0');
}

/** Formats base units as a decimal string without rounding. 12_500_000n with 6 decimals -> "12.5". */
export function formatAmount(units: bigint, decimals: number, minFractionDigits = 0): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  let frac = decimals > 0 ? (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '') : '';
  frac = frac.padEnd(minFractionDigits, '0');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}
