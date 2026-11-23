// Retries with exponential backoff, for network calls (Solana RPC, GitHub, Firecrawl, Supabase).
// Only transient failures are retried: a program error (the chain said no) is final.

export interface RetryOptions {
  /** Total attempts, including the first (default 4). */
  attempts?: number;
  /** First wait; doubles each time (default 500 ms), capped at maxDelayMs (default 8 s). */
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryable?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

const TRANSIENT = [
  /\b429\b/,
  /too many requests/i,
  /\b50[0234]\b/,
  /service unavailable|bad gateway|gateway time-?out/i,
  /timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|socket hang up|fetch failed|network error/i,
  /blockhash not found|block height exceeded|transaction was not confirmed|node is behind/i,
];
const FINAL = [/custom program error/i, /Error Code: /, /AnchorError/, /InstructionError/];

/** True for failures worth retrying (network, rate limit, RPC lag); never for program errors. */
export function isTransientError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (FINAL.some((r) => r.test(text))) return false;
  return TRANSIENT.some((r) => r.test(text));
}

export async function withRetry<T>(fn: (attempt: number) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 4);
  const base = options.baseDelayMs ?? 500;
  const max = options.maxDelayMs ?? 8000;
  const retryable = options.retryable ?? isTransientError;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= attempts || !retryable(error)) throw error;
      const delay = Math.min(max, base * 2 ** (attempt - 1));
      options.onRetry?.(attempt, error, delay);
      await sleep(delay);
    }
  }
}
