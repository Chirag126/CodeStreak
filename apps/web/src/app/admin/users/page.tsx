import type { Metadata } from 'next';
import Link from 'next/link';
import { ModerationPanel } from '@/components/admin/moderation-panel';
import { Empty, PageHeader, Pager, short, StatusBadge, Table, td, when } from '@/components/admin/ui';
import { loadDirectory, pageOf, PAGE_SIZE } from '@/lib/admin/data';
import { requireOwnerPage } from '@/lib/admin/owner';
import { nowSecs } from '@/lib/insights/load';

export const metadata: Metadata = { title: 'Users' };

const STATUSES = ['all', 'active', 'pending', 'restricted', 'under_review', 'suspended', 'banned', 'pending_deletion', 'deleted'];
const SORTS = [
  ['created_desc', 'Newest'],
  ['created_asc', 'Oldest'],
  ['last_active', 'Last active'],
  ['username', 'Username'],
  ['reports', 'Most reported'],
];
const field = 'h-9 rounded-md border border-input bg-background px-2 text-sm';
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const owner = await requireOwnerPage();
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 120);
  const status = STATUSES.includes(one(sp.status)) ? one(sp.status) : 'all';
  const sort = SORTS.some(([k]) => k === one(sp.sort)) ? one(sp.sort) : 'created_desc';
  const page = pageOf(sp.page);
  const { total, rows } = await loadDirectory(owner.id, { q, status, sort, page }, nowSecs());

  return (
    <>
      <PageHeader title="Users" description="Every registered account. Search by name, email, username, internal or public ID, wallet address, GitHub or LeetCode username." />
      <form method="get" className="flex flex-wrap items-end gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Search…" className={`${field} w-72`} maxLength={120} />
        <select name="status" defaultValue={status} className={field} aria-label="Status">
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All statuses' : s.replace('_', ' ')}
            </option>
          ))}
        </select>
        <select name="sort" defaultValue={sort} className={field} aria-label="Sort">
          {SORTS.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <button className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Apply</button>
        {(q || status !== 'all' || sort !== 'created_desc') && (
          <Link href="/admin/users" className="px-2 text-sm text-muted-foreground underline underline-offset-4">
            Clear
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <Empty>No account matches.</Empty>
      ) : (
        <Table head={['User', 'Email', 'Status', 'Wallets', 'Accounts', 'Challenges', 'Streak', 'Reports / flags', 'Joined · last active', '']} minWidth="78rem">
          {rows.map((u) => (
            <tr key={u.id} className="hover:bg-muted/30">
              <td className={td}>
                <Link href={`/admin/users/${u.id}`} className="flex items-center gap-2.5">
                  {u.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={u.avatar_url} alt="" referrerPolicy="no-referrer" className="size-8 rounded-full border border-border object-cover" />
                  ) : (
                    <span className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-semibold">{(u.username ?? '?').slice(0, 2).toUpperCase()}</span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-medium hover:underline">{u.display_name ?? (u.username ? `@${u.username}` : 'No username yet')}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {u.username ? `@${u.username} · ` : ''}
                      {u.public_id}
                    </span>
                  </span>
                </Link>
              </td>
              <td className={td}>
                <span className="block truncate">{u.email ?? '—'}</span>
                <span className="text-xs text-muted-foreground">{u.email_confirmed_at ? 'Verified' : 'Not verified'}</span>
              </td>
              <td className={td}>
                <StatusBadge status={u.status} />
              </td>
              <td className={`${td} font-mono text-xs`}>{u.wallets.length ? u.wallets.map((w) => <span key={w} className="block">{short(w)}</span>) : '—'}</td>
              <td className={`${td} text-xs`}>
                <span className="block">GH: {u.github ?? '—'}</span>
                <span className="block">LC: {u.leetcode ?? '—'}</span>
              </td>
              <td className={`${td} tabular-nums`}>
                {u.joined} joined · {u.completed} survived
                <span className="block text-xs text-muted-foreground">{u.groups} groups</span>
              </td>
              <td className={`${td} tabular-nums`}>
                {u.currentStreak} <span className="text-xs text-muted-foreground">(best {u.longestStreak})</span>
              </td>
              <td className={`${td} text-xs`}>
                {u.open_reports > 0 ? <span className="text-warning">{u.open_reports} open</span> : '0'}
                {u.flags.length > 0 && <span className="block text-destructive-text">{u.flags.join(', ')}</span>}
              </td>
              <td className={`${td} text-xs text-muted-foreground`}>
                {u.created_at.slice(0, 10)}
                <span className="block">{when(u.last_sign_in_at)}</span>
              </td>
              <td className={td}>
                {u.id !== owner.id && (
                  <ModerationPanel userId={u.id} username={u.username} current={{ restrictions: u.restrictions }} flags={u.flags} actions={['warn', 'suspend', 'review', 'restrict', 'reinstate', 'flag_add']} triggerLabel="Quick action" triggerVariant="ghost" />
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pager basePath="/admin/users" params={{ q, status, sort }} page={page} total={total} pageSize={PAGE_SIZE} />
    </>
  );
}
