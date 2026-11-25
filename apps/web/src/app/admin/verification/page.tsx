import { explorerTxUrl } from '@codestreak/shared/program';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, PageHeader, Pager, short, Table, td, when } from '@/components/admin/ui';
import { Badge } from '@/components/ui/badge';
import { loadVerification, pageOf, PAGE_SIZE } from '@/lib/admin/data';
import { requireOwnerPage } from '@/lib/admin/owner';

export const metadata: Metadata = { title: 'Verification' };
type Row = Record<string, unknown>;
const one = <T,>(v: unknown) => (Array.isArray(v) ? v[0] : v) as T;

export default async function VerificationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwnerPage();
  const sp = await searchParams;
  const raw = (Array.isArray(sp.result) ? sp.result[0] : sp.result) ?? 'all';
  const result = ['verified', 'failed', 'indeterminate'].includes(raw) ? raw : 'all';
  const page = pageOf(sp.page);
  const { rows, total } = await loadVerification({ result, page });
  return (
    <>
      <PageHeader title="Verification" description="Every day result recorded on-chain, newest first. Each has a sealed receipt (evidence hash) and a record transaction.">
        <Link href="/admin/disputes" className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
          Dispute review queue
        </Link>
      </PageHeader>
      <div className="flex flex-wrap gap-1">
        {['all', 'verified', 'failed', 'indeterminate'].map((k) => (
          <Link key={k} href={`/admin/verification?result=${k}`} className={`rounded-full border px-3 py-1 text-sm capitalize ${k === result ? 'border-electric-400' : 'border-border text-muted-foreground hover:text-foreground'}`}>
            {k === 'indeterminate' ? 'undecided' : k}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <Empty>No results.</Empty>
      ) : (
        <Table head={['Player', 'Challenge', 'Day', 'Result', 'Evidence', 'Hash', 'Record tx', 'Recorded (UTC)']} minWidth="64rem">
          {(rows as Row[]).map((r) => {
            const m = one<Row>(r.memberships);
            const c = one<Row>(m.challenges);
            return (
              <tr key={`${r.membership_id}:${r.day}`}>
                <td className={td}>
                  <Link className="underline-offset-4 hover:underline" href={`/admin/users/${m.profile_id}`}>
                    @{String(one<Row>(m.profiles).username ?? '?')}
                  </Link>
                </td>
                <td className={td}>
                  {String(c.title)}
                  {c.visibility === 'private' && <span className="block text-xs text-muted-foreground">group</span>}
                </td>
                <td className={td}>{Number(r.day) + 1}</td>
                <td className={td}>
                  <Badge variant={r.result === 'verified' ? 'success' : r.result === 'failed' ? 'danger' : 'warning'}>{r.result === 'indeterminate' ? 'undecided' : String(r.result)}</Badge>
                </td>
                <td className={td}>
                  {String(r.evidence_count ?? 0)} · {String(r.source ?? '—')}
                </td>
                <td className={`${td} font-mono text-xs`} title={String(r.evidence_hash ?? '')}>
                  {short(String(r.evidence_hash ?? ''), 6)}
                </td>
                <td className={`${td} font-mono text-xs`}>
                  {r.record_tx ? (
                    <a className="underline" href={explorerTxUrl(String(r.record_tx))} target="_blank" rel="noreferrer">
                      {short(String(r.record_tx), 5)}
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td className={td}>{when(r.onchain_at as string)}</td>
              </tr>
            );
          })}
        </Table>
      )}
      <Pager basePath="/admin/verification" params={{ result }} page={page} total={total} pageSize={PAGE_SIZE} />
    </>
  );
}
