import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { NotificationCenter } from '@/components/notifications/notification-center';
import { SIGN_IN_PATH, USERNAME_PATH } from '@/lib/auth/routes';
import { getViewer } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const viewer = await getViewer();
  if (!viewer) redirect(SIGN_IN_PATH);
  if (!viewer.username) redirect(USERNAME_PATH);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="space-y-2">
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:underline">
          ← Dashboard
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Notifications</h1>
      </div>
      <NotificationCenter />
    </div>
  );
}
