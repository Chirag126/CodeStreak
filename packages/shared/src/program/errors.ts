// Turns raw Solana / Anchor / wallet failures into messages a user understands. Pure; used by the
// relayer (server) and the transaction UI (browser).
import { CODESTREAK_IDL_JSON } from './idl/codestreak.idl.js';

export interface FriendlyError {
  /** Stable machine-readable kind, for UI decisions and analytics. */
  code: string;
  /** Short headline. */
  title: string;
  /** One or two plain sentences: what happened and what to do. */
  message: string;
}

const PROGRAM_ERRORS = new Map<number, { name: string; msg: string }>(
  (CODESTREAK_IDL_JSON.errors as unknown as { code: number; name: string; msg: string }[]).map((e) => [e.code, { name: e.name, msg: e.msg }]),
);
const PROGRAM_ERRORS_BY_NAME = new Map([...PROGRAM_ERRORS.values()].map((e) => [e.name, e]));

/** Friendlier wording for the errors users actually hit; others use the program's own message. */
const OVERRIDES: Record<string, string> = {
  JoinClosed: 'Joining has closed for this challenge.',
  PoolFull: 'This challenge is full.',
  JoinAuthorityRequired: 'This is a private group. You need an invitation to join.',
  InvalidJoinAuthority: 'This invitation is not valid for this group.',
  SponsorshipClosed: 'Sponsoring is closed for this challenge.',
  ShieldWindowClosed: 'Too late to protect that day: the Shield grace period is over.',
  ShieldLimitReached: 'You have used all your Shields for this challenge.',
  DayAlreadyShielded: 'That day is already protected.',
  DayAlreadyVerified: 'That day is already verified, so it needs no Shield.',
  ShieldsDisabled: 'Shields are turned off for this challenge.',
  AlreadyClaimed: 'You already claimed this.',
  NothingToClaim: 'There is nothing to claim for you here.',
  NotSettled: 'This challenge has not been settled yet. Try again after settlement.',
  TooEarly: 'Too early: the verification and dispute windows are still open.',
  TransferAmountMismatch: 'This token is not supported (it charges a transfer fee).',
  InvalidVault: 'Wrong vault for this challenge.',
  NotSurvivor: 'Only players who kept their streak every day (Survived, after settlement) get a badge.',
  EntryNotApproved: 'CodeStreak has to approve this action, so it only works from the CodeStreak app. If the app refused it, your account page says why.',
  BadgeAlreadyMinted: 'This badge is already minted. There is exactly one per player per challenge.',
};

const ANCHOR_CONSTRAINTS: Record<string, string> = {
  AccountNotInitialized: 'Something this needs does not exist yet. Refresh and try again.',
  ConstraintTokenOwner: 'That token account does not belong to your wallet.',
  ConstraintTokenMint: 'That token is not the one this challenge uses.',
  AccountNotSigner: 'A required signature is missing. Approve the transaction in your wallet.',
};

function programError(name: string, msg: string): FriendlyError {
  return { code: `program.${name}`, title: 'The challenge rules refused this', message: OVERRIDES[name] ?? `${msg}.` };
}

/** Reads the first CodeStreak / Anchor error out of transaction logs. */
export function errorFromLogs(logs: readonly string[] | null | undefined): FriendlyError | null {
  if (!logs?.length) return null;
  for (const line of logs) {
    const named = /Error Code: (\w+)/.exec(line);
    if (named?.[1]) {
      const name = named[1];
      const known = PROGRAM_ERRORS_BY_NAME.get(name);
      if (known) return programError(name, known.msg);
      if (ANCHOR_CONSTRAINTS[name]) return { code: `anchor.${name}`, title: 'Transaction refused', message: ANCHOR_CONSTRAINTS[name] };
    }
    if (/insufficient funds/i.test(line)) {
      return { code: 'token.insufficient_funds', title: 'Not enough tokens', message: 'Your wallet does not have enough tokens for this. Get devnet USDC from the faucet and try again.' };
    }
    if (/insufficient lamports/i.test(line)) {
      return { code: 'sol.insufficient', title: 'Not enough SOL', message: 'Not enough devnet SOL to pay for this. Get some from the Solana faucet.' };
    }
  }
  return null;
}

/** Program error from its numeric code (e.g. `custom program error: 0x177c`). */
export function errorFromCode(code: number): FriendlyError | null {
  const known = PROGRAM_ERRORS.get(code);
  return known ? programError(known.name, known.msg) : null;
}

function messageOf(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const e = err as { message?: unknown; error?: unknown };
    if (typeof e.message === 'string') return e.message;
    if (e.error) return messageOf(e.error);
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * Best plain-language explanation of any transaction failure: wallet rejection, program rule,
 * missing funds, expired transaction, network trouble.
 */
export function friendlyTxError(err: unknown, logs?: readonly string[] | null): FriendlyError {
  const text = messageOf(err);
  const code = (err as { code?: unknown } | null)?.code;

  // Wallets report a user's "Reject" as code 4001 and/or a "rejected" message.
  if (code === 4001 || /user rejected|rejected the request|declined|cancell?ed by (the )?user|user denied/i.test(text)) {
    return { code: 'wallet.rejected', title: 'Cancelled in your wallet', message: 'You declined the request in your wallet. Nothing was sent and nothing was charged.' };
  }
  const fromLogs = errorFromLogs(logs ?? (err as { logs?: string[] } | null)?.logs);
  if (fromLogs) return fromLogs;
  const hex = /custom program error: 0x([0-9a-f]+)/i.exec(text);
  if (hex?.[1]) {
    const mapped = errorFromCode(parseInt(hex[1], 16));
    if (mapped) return mapped;
  }
  const custom = /"Custom":\s*(\d+)/.exec(text);
  if (custom?.[1]) {
    const mapped = errorFromCode(Number(custom[1]));
    if (mapped) return mapped;
  }
  if (/did not include it before its blockhash expired/i.test(text)) {
    return { code: 'tx.expired', title: 'Network busy', message: "Solana didn't include the transaction before it expired, so nothing was charged and nothing changed. Please try again." };
  }
  if (/exceeded CUs meter|computational budget exceeded/i.test(text)) {
    return { code: 'tx.compute', title: 'Try again', message: 'The transaction needed a little more computing than planned, so it was stopped and nothing changed. Please try again.' };
  }
  if (/blockhash not found|block height exceeded|expired/i.test(text)) {
    return { code: 'tx.expired', title: 'Took too long', message: 'The transaction expired before it was sent. Please try again.' };
  }
  if (/insufficient funds|insufficient lamports|attempt to debit an account but found no record/i.test(text)) {
    return { code: 'funds.insufficient', title: 'Not enough funds', message: 'Your wallet does not have enough for this. Top up from the devnet faucets and try again.' };
  }
  if (/failed to fetch|network|timeout|timed out|429|too many requests/i.test(text)) {
    return { code: 'network', title: 'Network problem', message: 'Could not reach Solana devnet. Check your connection and try again in a moment.' };
  }
  return { code: 'unknown', title: 'Something went wrong', message: 'The transaction did not go through. Please try again.' };
}
