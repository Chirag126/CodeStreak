'use client';

import type { NotificationItem, NotificationKind } from '@codestreak/shared';
import { AlarmClockIcon, BadgeCheckIcon, BellIcon, CoinsIcon, GavelIcon, GiftIcon, MailIcon, TrophyIcon, UserPlusIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SpeakButton } from '@/components/voice/speak-button';
import { cn } from '@/lib/utils';

const ICON: Record<NotificationKind, typeof BellIcon> = {
  invitation: MailIcon,
  member_joined: UserPlusIcon,
  sponsorship: GiftIcon,
  day_result: BadgeCheckIcon,
  deadline_warning: AlarmClockIcon,
  settlement: TrophyIcon,
  payout: CoinsIcon,
  dispute: GavelIcon,
  badge: TrophyIcon,
};

/** Milliseconds now, refreshed every 30 s (0 until mounted, so render stays pure). */
export function useClock(): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  return now;
}

function ago(iso: string, now: number): string {
  if (!now) return '';
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationList({ items, now, onOpen }: { items: NotificationItem[]; now: number; onOpen: (n: NotificationItem) => void }) {
  if (!items.length) return <p className="px-3 py-6 text-center text-sm text-muted-foreground">No notifications yet.</p>;
  return (
    <ul className="divide-y divide-border">
      {items.map((n) => {
        const Icon = ICON[n.kind] ?? BellIcon;
        const inner = (
          <div className={cn('flex gap-3 py-2.5 pr-10 pl-3 text-sm', !n.read_at && 'bg-cobalt-400/5')}>
            <Icon className={cn('mt-0.5 size-4 shrink-0', n.kind === 'deadline_warning' ? 'text-warning-400' : 'text-muted-foreground')} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className={cn('leading-snug', !n.read_at && 'font-medium')}>{n.title}</p>
              {n.body && <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>}
              <p className="mt-1 text-[11px] text-muted-foreground">{ago(n.created_at, now)}</p>
            </div>
            {!n.read_at && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-cobalt-400" aria-label="Unread" />}
          </div>
        );
        return (
          <li key={n.id} className="relative">
            {n.href ? (
              <Link href={n.href} onClick={() => onOpen(n)} className="block outline-none hover:bg-muted focus-visible:bg-muted">
                {inner}
              </Link>
            ) : (
              <button type="button" onClick={() => onOpen(n)} className="block w-full text-left hover:bg-muted">
                {inner}
              </button>
            )}
            <SpeakButton notificationId={n.id} className="absolute top-2 right-2" />
          </li>
        );
      })}
    </ul>
  );
}
