// Phase 35 follow-up - full history: every challenge the viewer played or sponsored, one row each,
// with filters and a CSV export. Pure (the loader in apps/web reads the rows with the viewer's RLS).
import { formatAmount } from './money.js';
import { TOKEN_DECIMALS, type Token } from './dashboard.js';

export type HistoryRole = 'player' | 'sponsor';
export type HistoryOutcome =
  | 'running' // open, not ended (or not started)
  | 'awaiting_settlement' // ended, not settled yet
  | 'survived'
  | 'failed'
  | 'voided'
  | 'cancelled'
  | 'sponsored'; // sponsor rows: the outcome is the challenge's

export const OUTCOME_LABELS: Record<HistoryOutcome, string> = {
  running: 'Running',
  awaiting_settlement: 'Awaiting settlement',
  survived: 'Survived',
  failed: 'Failed',
  voided: 'Voided',
  cancelled: 'Cancelled',
  sponsored: 'Sponsored',
};

export interface HistoryRow {
  key: string;
  role: HistoryRole;
  title: string;
  address: string | null;
  token: Token;
  startTs: number;
  endTs: number;
  numDays: number;
  outcome: HistoryOutcome;
  verified: number;
  failed: number;
  shielded: number;
  undecided: number;
  /** Stake (player) or sponsorship (sponsor), base units. */
  put: bigint;
  /** Paid back to the viewer so far (reward / refund / sponsor refund), base units. */
  received: bigint;
  badgeMint: string | null;
}

export function historyOutcome(
  role: HistoryRole,
  status: 'active' | 'survived' | 'failed' | 'voided',
  poolState: 'open' | 'cancelled' | 'settled',
  endTs: number,
  now: number,
): HistoryOutcome {
  if (poolState === 'cancelled') return 'cancelled';
  if (role === 'sponsor') return poolState === 'open' && now < endTs ? 'running' : 'sponsored';
  if (status !== 'active') return status;
  return now < endTs ? 'running' : 'awaiting_settlement';
}

export interface HistoryFilters {
  role?: HistoryRole | 'all';
  outcome?: HistoryOutcome | 'all';
  token?: Token | 'all';
  /** Case-insensitive match on the title. */
  q?: string;
}

const OUTCOMES = Object.keys(OUTCOME_LABELS) as HistoryOutcome[];

/** Filters from untrusted query parameters: anything unknown falls back to "all". */
export function parseHistoryFilters(p: Record<string, string | string[] | undefined>): Required<HistoryFilters> {
  const pick = (k: string) => (Array.isArray(p[k]) ? p[k]![0] : p[k]) ?? '';
  const role = pick('role');
  const outcome = pick('outcome');
  const token = pick('token');
  return {
    role: role === 'player' || role === 'sponsor' ? role : 'all',
    outcome: (OUTCOMES as string[]).includes(outcome) ? (outcome as HistoryOutcome) : 'all',
    token: token === 'sol' || token === 'usdc' ? token : 'all',
    q: pick('q').trim().slice(0, 80),
  };
}

export function filterHistory(rows: HistoryRow[], f: HistoryFilters): HistoryRow[] {
  const q = (f.q ?? '').toLowerCase();
  return rows
    .filter((r) => (!f.role || f.role === 'all' || r.role === f.role) && (!f.outcome || f.outcome === 'all' || r.outcome === f.outcome) && (!f.token || f.token === 'all' || r.token === f.token) && (!q || r.title.toLowerCase().includes(q)))
    .sort((a, b) => b.startTs - a.startTs || a.key.localeCompare(b.key));
}

export interface HistorySummary {
  challenges: number;
  survived: number;
  failed: number;
  verifiedDays: number;
  /** Per token: what went in and what came back (base units). */
  money: Partial<Record<Token, { put: bigint; received: bigint }>>;
}

export function summarizeHistory(rows: HistoryRow[]): HistorySummary {
  const s: HistorySummary = { challenges: rows.length, survived: 0, failed: 0, verifiedDays: 0, money: {} };
  for (const r of rows) {
    if (r.outcome === 'survived') s.survived++;
    if (r.outcome === 'failed') s.failed++;
    s.verifiedDays += r.verified;
    const m = (s.money[r.token] ??= { put: 0n, received: 0n });
    m.put += r.put;
    m.received += r.received;
  }
  return s;
}

/**
 * One CSV cell: quoted when needed, and a leading = + - @ (or tab / CR) neutralised with an
 * apostrophe so spreadsheets don't run a title as a formula (CSV injection).
 */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 byte-order mark, so Excel reads the file as UTF-8. */
const BOM = String.fromCharCode(0xfeff);
const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

export function historyCsv(rows: HistoryRow[]): string {
  const header = ['Role', 'Challenge', 'Address', 'Token', 'Start (UTC)', 'End (UTC)', 'Days', 'Outcome', 'Verified', 'Failed', 'Shielded', 'Undecided', 'Put in', 'Received', 'Badge mint'];
  const lines = rows.map((r) =>
    [
      r.role,
      r.title,
      r.address ?? '',
      r.token.toUpperCase(),
      iso(r.startTs),
      iso(r.endTs),
      r.numDays,
      OUTCOME_LABELS[r.outcome],
      r.verified,
      r.failed,
      r.shielded,
      r.undecided,
      formatAmount(r.put, TOKEN_DECIMALS[r.token]),
      formatAmount(r.received, TOKEN_DECIMALS[r.token]),
      r.badgeMint ?? '',
    ]
      .map(csvCell)
      .join(','),
  );
  // CRLF and a BOM: Excel opens UTF-8 (· and non-Latin titles) correctly.
  return `${BOM}${[header.join(','), ...lines].join('\r\n')}\r\n`;
}
