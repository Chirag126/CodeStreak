import { formatAmount } from '@codestreak/shared';
import { explorerTxUrl } from '@codestreak/shared/program';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, PageHeader, Pager, short, Table, td, when } from '@/components/admin/ui';
import { Badge } from '@/components/ui/badge';
import { loadTransactions, pageOf, PAGE_SIZE } from '@/lib/admin/data';
import { requireOwnerPage } from '@/lib/admin/owner';

export const metadata: Metadata = { title: 'Transactions' };
type Row = Record<string, unknown>;
const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T;
const KINDS = [
  ['all', 'All confirmed'],
  ['join', 'Entries'],
  ['shield', 'Shields'],
  ['sponsor', 'Sponsorships'],
  ['reward', 'Rewards'],
  ['refund', 'Refunds'],
  ['sponsor_refund', 'Sponsor refunds'],
  ['pending', 'Pending (app)'],
  ['failed', 'Failed (app)'],
];
const STATUS: Record<string, [string, 'success' | 'danger' | 'warning' | 'outline']> = {
  finalized: ['finalized', 'success'],
  confirmed: ['confirmed', 'success'],
  processed: ['processed', 'warning'],
  failed: ['failed', 'danger'],
  not_found: ['not found', 'danger'],
  unknown: ['chain unreachable', 'outline'],
};

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwnerPage();
  const sp = await searchParams;
  const kindRaw = (Array.isArray(sp.kind) ? sp.kind[0] : sp.kind) ?? 'all';
  const kind = KINDS.some(([k]) => k === kindRaw) ? kindRaw : 'all';
  const page = pageOf(sp.page);
  const data = await loadTransactions({ kind, page });
  return (
    <>
      <PageHeader title="Transactions" description="Confirmed receipts are re-checked against Solana devnet (status column). Pending and failed are app records of relayed requests, not on-chain proof." />
      <div className="flex flex-wrap gap-1">
        {KINDS.map(([k, l]) => (
          <Link key={k} href={`/admin/transactions?kind=${k}`} className={`rounded-full border px-3 py-1 text-sm ${k === kind ? 'border-electric-400' : 'border-border text-muted-foreground hover:text-foreground'}`}>
            {l}
          </Link>
        ))}
      </div>
      {data.rows.length === 0 ? (
        <Empty>Nothing here.</Empty>
      ) : data.kind === 'receipts' ? (
        <Table head={['Kind', 'User', 'Amount', 'Challenge', 'Signature', 'On-chain', 'Network', 'Time (UTC)']} minWidth="66rem">
          {(data.rows as Row[]).map((r) => {
            const c = one<Row>(r.challenges);
            const u = one<Row | null>(r.profile);
            const st = STATUS[data.onchain[String(r.tx_signature)] ?? 'unknown']!;
            return (
              <tr key={String(r.id)}>
                <td className={td}>{String(r.kind).replace('_', ' ')}</td>
                <td className={td}>{u ? <Link className="underline-offset-4 hover:underline" href={`/admin/users/${u.id}`}>@{String(u.username ?? '?')}</Link> : <span className="font-mono text-xs">{short(String(r.wallet))}</span>}</td>
                <td className={`${td} tabular-nums`}>
                  {formatAmount(BigInt(String(r.amount)), c.token === 'sol' ? 9 : 6)} {String(c.token).toUpperCase()}
                </td>
                <td className={td}>
                  {String(c.title)}
                  {c.visibility === 'private' && <span className="block text-xs text-muted-foreground">group</span>}
                </td>
                <td className={`${td} font-mono text-xs`}>
                  <a className="underline" href={explorerTxUrl(String(r.tx_signature))} target="_blank" rel="noreferrer">
                    {short(String(r.tx_signature), 6)}
                  </a>
                </td>
                <td className={td}>
                  <Badge variant={st[1]}>{st[0]}</Badge>
                </td>
                <td className={td}>devnet</td>
                <td className={td}>{when(r.confirmed_at as string)}</td>
              </tr>
            );
          })}
        </Table>
      ) : (
        <Table head={['Kind', 'User', 'Status', 'Error', 'Signature', 'Created (UTC)']} minWidth="56rem">
          {(data.rows as Row[]).map((r) => {
            const u = one<Row | null>(r.profile);
            return (
              <tr key={String(r.id)}>
                <td className={td}>{String(r.kind)}</td>
                <td className={td}>{u ? <Link className="underline-offset-4 hover:underline" href={`/admin/users/${u.id}`}>@{String(u.username ?? '?')}</Link> : '—'}</td>
                <td className={td}>
                  <Badge variant={r.status === 'failed' ? 'danger' : 'outline'}>{String(r.status)}</Badge>
                </td>
                <td className={`${td} max-w-sm text-xs`}>{String(r.error ?? '—')}</td>
                <td className={`${td} font-mono text-xs`}>{r.signature ? short(String(r.signature), 6) : '—'}</td>
                <td className={td}>{when(r.created_at as string)}</td>
              </tr>
            );
          })}
        </Table>
      )}
      <Pager basePath="/admin/transactions" params={{ kind }} page={page} total={data.total} pageSize={PAGE_SIZE} />
    </>
  );
}
