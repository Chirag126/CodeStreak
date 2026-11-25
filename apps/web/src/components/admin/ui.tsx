import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function PageHeader({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'warn' | 'danger' | 'good' }) {
  return (
    <Card>
      <CardContent className="space-y-1 py-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={cn('text-2xl font-semibold tabular-nums', tone === 'warn' && 'text-warning', tone === 'danger' && 'text-destructive-text', tone === 'good' && 'text-success')}>{value}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

const STATUS: Record<string, { label: string; variant: 'success' | 'danger' | 'warning' | 'outline' | 'primary' | 'accent' }> = {
  active: { label: 'Active', variant: 'success' },
  pending: { label: 'Pending', variant: 'outline' },
  restricted: { label: 'Restricted', variant: 'warning' },
  under_review: { label: 'Under review', variant: 'accent' },
  suspended: { label: 'Suspended', variant: 'warning' },
  banned: { label: 'Banned', variant: 'danger' },
  pending_deletion: { label: 'Deletion scheduled', variant: 'danger' },
  deleted: { label: 'Deleted', variant: 'outline' },
};
export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, variant: 'outline' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/** Server-rendered pager: keeps the current query string, swaps the page number. */
export function Pager({ basePath, params, page, total, pageSize }: { basePath: string; params: Record<string, string>; page: number; total: number; pageSize: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => `${basePath}?${new URLSearchParams({ ...params, page: String(p) }).toString()}`;
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>
        {total === 0 ? 'No results' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
      </span>
      <span className="flex gap-2">
        {page > 1 ? (
          <Link className="rounded-md border border-border px-3 py-1 hover:bg-muted" href={href(page - 1)}>
            Previous
          </Link>
        ) : (
          <span className="rounded-md border border-border px-3 py-1 opacity-40">Previous</span>
        )}
        <span className="px-1 py-1 tabular-nums">
          {page} / {pages}
        </span>
        {page < pages ? (
          <Link className="rounded-md border border-border px-3 py-1 hover:bg-muted" href={href(page + 1)}>
            Next
          </Link>
        ) : (
          <span className="rounded-md border border-border px-3 py-1 opacity-40">Next</span>
        )}
      </span>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

export function Table({ head, children, minWidth = '48rem' }: { head: string[]; children: React.ReactNode; minWidth?: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm" style={{ minWidth }}>
        <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export const td = 'px-3 py-2.5 align-top';
export const short = (s: string | null | undefined, n = 4) => (s ? (s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-n)}` : s) : '—');
export const when = (iso: string | null | undefined) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '—');
