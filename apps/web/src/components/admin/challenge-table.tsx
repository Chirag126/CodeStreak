import { formatAmount } from '@codestreak/shared';
import Link from 'next/link';
import { Empty, Pager, Table, td, when } from '@/components/admin/ui';
import { Badge } from '@/components/ui/badge';
import { loadChallenges, PAGE_SIZE } from '@/lib/admin/data';

type Row = Record<string, unknown>;
const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T;
const field = 'h-9 rounded-md border border-input bg-background px-2 text-sm';

/** Shared list for Challenges (all) and Groups (private only). */
export async function ChallengeTable({ basePath, visibility, q, state, page }: { basePath: string; visibility: 'public' | 'private' | 'all'; q: string; state: string; page: number }) {
  const { rows, total } = await loadChallenges({ q, visibility, state, page });
  return (
    <>
      <form method="get" className="flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Title…" className={`${field} w-64`} maxLength={80} />
        <select name="state" defaultValue={state} className={field} aria-label="State">
          <option value="all">All states</option>
          <option value="open">Open</option>
          <option value="settled">Settled</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Apply</button>
      </form>
      {rows.length === 0 ? (
        <Empty>Nothing matches.</Empty>
      ) : (
        <Table head={['Challenge', 'Creator', 'Visibility', 'State', 'Players', 'Pool', 'Starts', 'Length']} minWidth="62rem">
          {(rows as Row[]).map((c) => {
            const dec = c.token === 'sol' ? 9 : 6;
            const unit = String(c.token).toUpperCase();
            return (
              <tr key={String(c.id)}>
                <td className={td}>
                  <Link className="font-medium underline-offset-4 hover:underline" href={`/challenges/${c.onchain_address}`}>
                    {String(c.title)}
                  </Link>
                </td>
                <td className={td}>@{String(one<Row | null>(c.creator)?.username ?? '?')}</td>
                <td className={td}>{c.visibility === 'private' ? 'Group' : 'Public'}</td>
                <td className={td}>
                  <Badge variant={c.pool_state === 'open' ? 'primary' : c.pool_state === 'settled' ? 'success' : 'outline'}>{String(c.pool_state)}</Badge>
                </td>
                <td className={`${td} tabular-nums`}>{String(c.participant_count)}</td>
                <td className={`${td} tabular-nums`}>
                  {formatAmount(BigInt(String(c.total_stake)) + BigInt(String(c.total_sponsor)), dec)} {unit}
                </td>
                <td className={td}>{when(c.start_at as string)}</td>
                <td className={td}>
                  {String(c.num_days)} × {Number(c.day_length_secs) >= 86400 ? '1 day' : `${Math.round(Number(c.day_length_secs) / 60)} min`}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
      <Pager basePath={basePath} params={{ q, state }} page={page} total={total} pageSize={PAGE_SIZE} />
    </>
  );
}
