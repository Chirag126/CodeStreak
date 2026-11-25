// Phase 37 - the public profile at /u/[username], as a pure function of the player's records.
//
// Privacy rule: a private group's DETAILS never appear (title, address, dates, members, days,
// transactions, badge mint). The player's own ACHIEVEMENTS do: private groups count in the totals
// (streak, success rate, survived, rewards), and a badge from a private group shows as
// "Private challenge" with no link. History lists public challenges, plus a count of private ones.
// The builder is the gate: everything it returns about a private row is anonymous by construction.
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
  /** "Private challenge" for private groups. */
  title: string;
  /** Null for private groups: no link, no mint, no transaction. */
  address: string | null;
  numDays: number;
  mint: string | null;
  tx: string | null;
  isPrivate: boolean;
  /** True: the token account holds it (read from chain). Null: the chain couldn't be read just now. */
  inWallet: boolean | null;
}

export interface PublicProfileStats {
  currentStreak: number;
  longestStreak: number;
  successRate: number | null;
  recordedDays: number;
  /** Challenges joined (public + private), and those that reached settlement. */
  challenges: number;
  finished: number;
  survived: number;
  /** Reward above the stake, per token (survivors with a payout). */
  earned: Partial<Record<Token, bigint>>;
}

export interface PublicProfileBody {
  stats: PublicProfileStats;
  history: ProfileHistoryRow[];
  /** Private challenges left out of the history (details hidden). */
  privateChallenges: number;
  badges: ProfileBadge[];
}

export function buildPublicProfile(rows: ProfileChallengeInput[], now: number): PublicProfileBody {
  // Only rows that exist on-chain count at all.
  const onchain = rows.filter((r) => r.address);
  const pub = onchain.filter((r) => r.visibility === 'public');
  const privateCount = onchain.length - pub.length;

  // Totals: every challenge, private included (numbers only, nothing identifying).
  const days = onchain.flatMap((r, i) =>
    r.results.map((d) => ({ challenge: `${i}`, startedAt: r.startTs + d.day * r.dayLengthSecs, result: d.result, shielded: r.shieldDays.includes(d.day) })),
  );
  const ins = computeInsights(days, [], now, 1);
  const earned: Partial<Record<Token, bigint>> = {};
  for (const r of onchain) {
    if (r.status !== 'survived' || r.payout === null || r.payout <= r.deposited) continue;
    earned[r.token] = (earned[r.token] ?? 0n) + (r.payout - r.deposited);
  }

  // History: public challenges only, with their links.
  const history: ProfileHistoryRow[] = pub
    .map((r) => {
      const shielded = new Set(r.shieldDays);
      const count = (pred: (d: ProfileChallengeInput['results'][number]) => boolean) => r.results.filter(pred).length;
      const endTs = r.startTs + r.numDays * r.dayLengthSecs;
      return {
        title: r.title,
        address: r.address!,
        token: r.token,
        startTs: r.startTs,
        endTs,
        numDays: r.numDays,
        outcome: historyOutcome('player', r.status, r.poolState, endTs, now, r.payout),
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

  // Badges: all of them; a private one is anonymous (built field by field, nothing copied over).
  const badges: ProfileBadge[] = onchain
    .filter((r) => r.badge && r.status === 'survived')
    .map((r) =>
      r.visibility === 'public'
        ? { title: r.title, address: r.address, numDays: r.numDays, mint: r.badge!.mint, tx: r.badge!.tx, isPrivate: false, inWallet: r.badge!.inWallet }
        : { title: 'Private challenge', address: null, numDays: r.numDays, mint: null, tx: null, isPrivate: true, inWallet: r.badge!.inWallet },
    )
    .sort((a, b) => b.numDays - a.numDays || Number(a.isPrivate) - Number(b.isPrivate));

  return {
    stats: {
      currentStreak: ins.currentStreak,
      longestStreak: ins.longestStreak,
      successRate: ins.successRate,
      recordedDays: ins.recordedDays,
      challenges: onchain.length,
      finished: onchain.filter((r) => r.poolState === 'settled').length,
      survived: onchain.filter((r) => r.status === 'survived').length,
      earned,
    },
    history,
    privateChallenges: privateCount,
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
