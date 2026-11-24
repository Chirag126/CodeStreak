// Phase 33 - the notification inbox as the browser keeps it (pure): Realtime inserts/updates are
// merged by id (a reconnect replay can't duplicate), newest first, capped, with the unread count.

export type NotificationKind = 'invitation' | 'member_joined' | 'sponsorship' | 'day_result' | 'deadline_warning' | 'settlement' | 'payout' | 'dispute' | 'badge';

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  href: string | null;
  created_at: string;
  read_at: string | null;
}

export interface Inbox {
  items: NotificationItem[];
  unread: number;
}

export const INBOX_LIMIT = 50;

export type InboxEvent =
  | { type: 'reset'; items: NotificationItem[]; unread: number }
  | { type: 'upsert'; item: NotificationItem }
  | { type: 'read'; ids: string[] | 'all'; at: string };

export function inboxReducer(state: Inbox, e: InboxEvent): Inbox {
  switch (e.type) {
    case 'reset':
      return { items: [...e.items].sort(newestFirst).slice(0, INBOX_LIMIT), unread: e.unread };
    case 'upsert': {
      const prev = state.items.find((i) => i.id === e.item.id);
      const items = [e.item, ...state.items.filter((i) => i.id !== e.item.id)].sort(newestFirst).slice(0, INBOX_LIMIT);
      // Unread total may include items beyond the loaded page: adjust by the change only.
      const delta = (e.item.read_at ? 0 : 1) - (prev ? (prev.read_at ? 0 : 1) : 0);
      return { items, unread: Math.max(0, state.unread + delta) };
    }
    case 'read': {
      if (e.ids === 'all') return { items: state.items.map((i) => (i.read_at ? i : { ...i, read_at: e.at })), unread: 0 };
      const ids = new Set(e.ids);
      const marked = state.items.filter((i) => ids.has(i.id) && !i.read_at).length;
      return { items: state.items.map((i) => (ids.has(i.id) && !i.read_at ? { ...i, read_at: e.at } : i)), unread: Math.max(0, state.unread - marked) };
    }
  }
}

function newestFirst(a: NotificationItem, b: NotificationItem) {
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1;
}

export const emptyInbox: Inbox = { items: [], unread: 0 };
