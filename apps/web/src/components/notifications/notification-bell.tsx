'use client';

import { BellIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { NotificationList, useClock } from './notification-list';
import { useInbox } from './use-inbox';

/** Header bell: unread count, newest notifications, live over Realtime. Hidden when signed out. */
export function NotificationBell() {
  const inbox = useInbox(12);
  const [open, setOpen] = useState(false);
  const now = useClock();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  if (!inbox.signedIn) return null;
  const label = inbox.unread ? `Notifications, ${inbox.unread} unread` : 'Notifications';
  return (
    <div ref={box} className="relative">
      <Button variant="ghost" size="icon" aria-label={label} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}
        className="relative"
      >
        <BellIcon />
        {inbox.unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-cobalt-400 px-1 text-center text-[10px] font-semibold leading-4 text-white tabular-nums">
            {inbox.unread > 99 ? '99+' : inbox.unread}
          </span>
        )}
      </Button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            {inbox.unread > 0 && (
              <button type="button" className="text-xs text-muted-foreground underline-offset-4 hover:underline" onClick={() => void inbox.markRead('all')}>
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[26rem] overflow-y-auto">
            <NotificationList
              items={inbox.items}
              now={now}
              onOpen={(n) => {
                if (!n.read_at) void inbox.markRead([n.id]);
                setOpen(false);
              }}
            />
          </div>
          <Link href="/dashboard/notifications" onClick={() => setOpen(false)} className="block border-t border-border px-3 py-2 text-center text-xs text-muted-foreground hover:bg-muted">
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
