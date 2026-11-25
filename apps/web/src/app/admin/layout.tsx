import type { Metadata } from 'next';
import { AdminNav } from '@/components/admin/admin-nav';
import { requireOwnerPage } from '@/lib/admin/owner';

export const metadata: Metadata = { title: { default: 'Control Center', template: '%s · Control Center' }, robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Developer Control Center (Phase 37.1). The owner gate runs on the server for every page under
 * /admin: anyone else gets a plain 404. Server actions and API routes re-check on their own.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const owner = await requireOwnerPage();
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 lg:flex-row">
      <aside className="shrink-0 lg:w-56">
        <div className="mb-3 hidden space-y-0.5 px-3 lg:block">
          <p className="text-sm font-semibold">Control Center</p>
          <p className="truncate text-xs text-muted-foreground" title={owner.email}>
            {owner.email}
          </p>
          {!owner.recentSignIn && <p className="text-xs text-warning">Sign in again to unlock irreversible actions.</p>}
        </div>
        <AdminNav />
      </aside>
      <main className="min-w-0 flex-1 space-y-6">{children}</main>
    </div>
  );
}
