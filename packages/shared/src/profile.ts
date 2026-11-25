// Phase 37 - the public profile at /u/[username], as a pure function of the player's records.
//
// Privacy rule: ONLY public challenges appear, in every number and list. The loader filters by
// visibility in its queries, and this builder filters again, so a private group's title, address,
// days, money or badge can never reach the page, even if a query changes. Totals are labelled
// "public challenges".
import { computeInsights } from './insights.js';
import { historyOutcome, type HistoryOutcome } from './history.js';
import type { Token } from './dashboard.js';

export interface ProfileChallengeInput {
  visibility: 'public' | 'private';
  title: string;
  address: string | null;
  token: Token;
  startTs: number;
  dayLengthSecs: number;
  numDays: number;
  poolState: 'open' | 'cancelled' | 'settled';
  status: 'active' | 'survived' | 'failed' | 'voided';
  deposited: bigint;
  payout: bigint | null;
  /** On-chain-recorded results by day. */
  results: { day: number; result: 'verified' | 'failed' | 'indeterminate' }[];
  shieldDays: number[];
  joinTx: string | null;
  payoutTx: string | null;
  badge: { mint: string; tx: string | null; inWallet: boolean | null } | null;
}

export interface ProfileHistoryRow {
  title: string;
  address: string;
  token: Token;
  startTs: number;
  endTs: number;
  numDays: number;
  outcome: HistoryOutcome;
  verified: number;
  failed: number;
  shielded: number;
  stake: bigint;
  received: bigint | null;
  joinTx: string | null;
  payoutTx: string | null;
  badgeMint: string | null;
}

export interface ProfileBadge {
  title: string;
  address: string;
  numDays: number;
  mint: string;
  tx: string | null;
  /** True: the token account holds it (read from chain). Null: the chain couldn't be read just now. */
  inWallet: boolean | null;
}

export interface PublicProfileStats {
  currentStreak: number;
  longestStreak: number;
  successRate: number | null;
  recordedDays: number;
  challenges: number;
  survived: number;
  /** Reward above the stake, per token (survivors with a payout). */
  earned: Partial<Record<Token, bigint>>;
}

export interface PublicProfileBody {
  stats: PublicProfileStats;
  history: ProfileHistoryRow[];
  badges: ProfileBadge[];
}

export function buildPublicProfile(rows: ProfileChallengeInput[], now: number): PublicProfileBody {
  // The privacy gate: anything not explicitly public, or without an address, is dropped here.
  const pub = rows.filter((r) => r.visibility === 'public' && r.address);

  const days = pub.flatMap((r, i) =>
    r.results.map((d) => ({ challenge: `${i}`, startedAt: r.startTs + d.day * r.dayLengthSecs, result: d.result, shielded: r.shieldDays.includes(d.day) })),
  );
  const ins = computeInsights(days, [], now, 1);

  const earned: Partial<Record<Token, bigint>> = {};
  for (const r of pub) {
    if (r.status !== 'survived' || r.payout === null || r.payout <= r.deposited) continue;
    earned[r.token] = (earned[r.token] ?? 0n) + (r.payout - r.deposited);
  }

  const history: ProfileHistoryRow[] = pub
    .map((r) => {
      const shielded = new Set(r.shieldDays);
      const count = (pred: (d: ProfileChallengeInput['results'][number]) => boolean) => r.results.filter(pred).length;
      return {
        title: r.title,
        address: r.address!,
        token: r.token,
        startTs: r.startTs,
        endTs: r.startTs + r.numDays * r.dayLengthSecs,
        numDays: r.numDays,
        outcome: historyOutcome('player', r.status, r.poolState, r.startTs + r.numDays * r.dayLengthSecs, now),
        verified: count((d) => d.result === 'verified'),
        failed: count((d) => d.result === 'failed' && !shielded.has(d.day)),
        shielded: count((d) => d.result !== 'verified' && shielded.has(d.day)),
        stake: r.deposited,
        received: r.payout,
        joinTx: r.joinTx,
        payoutTx: r.payoutTx,
        badgeMint: r.badge?.mint ?? null,
      };
    })
    .sort((a, b) => b.startTs - a.startTs);

  const badges: ProfileBadge[] = pub
    .filter((r) => r.badge && r.status === 'survived')
    .map((r) => ({ title: r.title, address: r.address!, numDays: r.numDays, mint: r.badge!.mint, tx: r.badge!.tx, inWallet: r.badge!.inWallet }))
    .sort((a, b) => b.numDays - a.numDays);

  return {
    stats: {
      currentStreak: ins.currentStreak,
      longestStreak: ins.longestStreak,
      successRate: ins.successRate,
      recordedDays: ins.recordedDays,
      challenges: pub.length,
      survived: pub.filter((r) => r.status === 'survived').length,
      earned,
    },
    history,
    badges,
  };
}

/** Usernames are lowercase a-z, 0-9, _ (3-20). Anything else is not a profile URL. */
export function usernameFromPath(raw: string): string | null {
  let u: string;
  try {
    u = decodeURIComponent(raw);
  } catch {
    return null; // malformed %-escape
  }
  u = u.trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_]{3,20}$/.test(u) ? u : null;
}
