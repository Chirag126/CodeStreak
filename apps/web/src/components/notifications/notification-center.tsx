'use client';

import type { NotificationKind } from '@codestreak/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { NotificationList, useClock } from './notification-list';
import { useInbox } from './use-inbox';

const FILTERS: { label: string; kinds: NotificationKind[] | null }[] = [
  { label: 'All', kinds: null },
  { label: 'Deadlines', kinds: ['deadline_warning'] },
  { label: 'Results', kinds: ['day_result', 'dispute'] },
  { label: 'Money', kinds: ['payout', 'settlement', 'sponsorship'] },
  { label: 'Groups', kinds: ['invitation', 'member_joined', 'badge'] },
];

/** Dashboard → Notifications: everything, live, with filters and mark-as-read. */
export function NotificationCenter() {
  const inbox = useInbox(50);
  const [filter, setFilter] = useState(0);
  const now = useClock();
  const kinds = FILTERS[filter]!.kinds;
  const items = kinds ? inbox.items.filter((n) => kinds.includes(n.kind)) : inbox.items;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Filter" className="flex flex-wrap gap-1">
          {FILTERS.map((f, i) => (
            <Button key={f.label} role="tab" aria-selected={i === filter} size="sm" variant={i === filter ? 'secondary' : 'ghost'} onClick={() => setFilter(i)}>
              {f.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground" aria-live="polite">
            {inbox.unread} unread
          </span>
          <Button size="sm" variant="outline" disabled={!inbox.unread} onClick={() => void inbox.markRead('all')}>
            Mark all read
          </Button>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          {inbox.loaded ? (
            <NotificationList items={items} now={now} onOpen={(n) => !n.read_at && void inbox.markRead([n.id])} />
          ) : (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        New notifications appear here and on the bell instantly. Deadline warnings go out {`3 hours`} before a day ends (UTC) when that day isn&apos;t verified
        yet; on short demo days, a quarter of the day before.
      </p>
    </div>
  );
}
