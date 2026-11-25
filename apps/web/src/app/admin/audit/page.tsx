import type { Metadata } from 'next';
import Link from 'next/link';
import { Empty, PageHeader, Pager, Table, td, when } from '@/components/admin/ui';
import { VerifyChainButton } from '@/components/admin/verify-chain-button';
import { loadAudit, pageOf, PAGE_SIZE } from '@/lib/admin/data';
import { requireOwnerPage } from '@/lib/admin/owner';

export const metadata: Metadata = { title: 'Audit Logs' };
type Row = Record<string, unknown>;

/** Only the fields that changed (before → after), so an entry reads at a glance. */
function diff(before: Row, after: Row): string {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  return keys
    .filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]))
    .map((k) => `${k}: ${JSON.stringify(before?.[k] ?? null)} → ${JSON.stringify(after?.[k] ?? null)}`)
    .join(' · ');
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwnerPage();
  const page = pageOf((await searchParams).page);
  const { rows, total } = await loadAudit(page);
  return (
    <>
      <PageHeader title="Audit Logs" description="Append-only: the database refuses edits and deletions. Each entry is SHA-256-chained to the previous one, so any tampering breaks the chain.">
        <VerifyChainButton />
      </PageHeader>
      {rows.length === 0 ? (
        <Empty>No admin actions yet.</Empty>
      ) : (
        <Table head={['#', 'Time (UTC)', 'Action', 'Target', 'Reason', 'Changes', 'Hash']} minWidth="70rem">
          {(rows as Row[]).map((r) => (
            <tr key={String(r.id)}>
              <td className={`${td} tabular-nums text-muted-foreground`}>{String(r.id)}</td>
              <td className={td}>{when(r.at as string)}</td>
              <td className={`${td} font-mono text-xs`}>{String(r.action)}</td>
              <td className={td}>
                {r.target_profile ? (
                  <Link className="underline-offset-4 hover:underline" href={`/admin/users/${r.target_profile}`}>
                    {r.target_username ? `@${r.target_username}` : String(r.target_profile).slice(0, 8)}
                  </Link>
                ) : (
                  '—'
                )}
              </td>
              <td className={`${td} max-w-xs text-xs`}>{String(r.reason ?? '—')}</td>
              <td className={`${td} max-w-md break-words text-xs text-muted-foreground`}>{diff(r.before as Row, r.after as Row) || '—'}</td>
              <td className={`${td} font-mono text-xs text-muted-foreground`} title={`prev ${r.prev_hash}`}>
                {String(r.hash).slice(0, 12)}…
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pager basePath="/admin/audit" params={{}} page={page} total={total} pageSize={PAGE_SIZE} />
    </>
  );
}
