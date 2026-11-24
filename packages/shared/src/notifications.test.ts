import { describe, expect, it } from 'vitest';
import { emptyInbox, inboxReducer, type NotificationItem } from './notifications.js';

const n = (id: string, at: string, read: string | null = null): NotificationItem => ({ id, kind: 'day_result', title: id, body: '', href: null, created_at: at, read_at: read });

describe('inbox (realtime updates)', () => {
  it('adds a realtime insert on top and counts it unread', () => {
    let s = inboxReducer(emptyInbox, { type: 'reset', items: [n('a', '2026-11-24T10:00:00Z')], unread: 1 });
    s = inboxReducer(s, { type: 'upsert', item: n('b', '2026-11-24T11:00:00Z') });
    expect(s.items.map((i) => i.id)).toEqual(['b', 'a']);
    expect(s.unread).toBe(2);
  });
  it('a replayed insert (reconnect) is not duplicated or double-counted', () => {
    let s = inboxReducer(emptyInbox, { type: 'upsert', item: n('a', '2026-11-24T10:00:00Z') });
    s = inboxReducer(s, { type: 'upsert', item: n('a', '2026-11-24T10:00:00Z') });
    expect(s.items).toHaveLength(1);
    expect(s.unread).toBe(1);
  });
  it('a realtime update marking it read (other tab) lowers the count', () => {
    let s = inboxReducer(emptyInbox, { type: 'upsert', item: n('a', '2026-11-24T10:00:00Z') });
    s = inboxReducer(s, { type: 'upsert', item: n('a', '2026-11-24T10:00:00Z', '2026-11-24T10:05:00Z') });
    expect(s.unread).toBe(0);
  });
  it('marks some or all read', () => {
    let s = inboxReducer(emptyInbox, { type: 'reset', items: [n('a', '1'), n('b', '2'), n('c', '3')], unread: 7 });
    s = inboxReducer(s, { type: 'read', ids: ['a', 'zz'], at: 'now' });
    expect(s.unread).toBe(6);
    s = inboxReducer(s, { type: 'read', ids: ['a'], at: 'now' });
    expect(s.unread).toBe(6);
    s = inboxReducer(s, { type: 'read', ids: 'all', at: 'now' });
    expect(s).toMatchObject({ unread: 0 });
    expect(s.items.every((i) => i.read_at)).toBe(true);
  });
});
