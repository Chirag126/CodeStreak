// Realtime connection state for the group board (pure). The hook feeds it channel statuses and
// browser online/offline events; it decides what to show, when to resubscribe, and when the board
// must be re-fetched (any time we may have missed changes).

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

export interface LiveState {
  status: LiveStatus;
  /** Failed attempts since the last successful subscribe (drives the backoff). */
  attempt: number;
  /** True once we have been disconnected: the next successful subscribe must re-fetch. */
  missedChanges: boolean;
}

export type LiveEvent =
  | { type: 'SUBSCRIBED' }
  | { type: 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED' }
  | { type: 'OFFLINE' }
  | { type: 'ONLINE' }
  | { type: 'RETRY' }
  /** The board was re-fetched after a reconnect. */
  | { type: 'CAUGHT_UP' };

export const initialLive: LiveState = { status: 'connecting', attempt: 0, missedChanges: false };

export function liveReducer(s: LiveState, e: LiveEvent): LiveState {
  switch (e.type) {
    case 'SUBSCRIBED':
      return { status: 'live', attempt: 0, missedChanges: s.missedChanges };
    case 'CHANNEL_ERROR':
    case 'TIMED_OUT':
    case 'CLOSED':
      if (s.status === 'offline') return s; // already down; wait for ONLINE
      return { status: 'reconnecting', attempt: s.attempt + 1, missedChanges: true };
    case 'OFFLINE':
      return { status: 'offline', attempt: s.attempt, missedChanges: true };
    case 'ONLINE':
      return s.status === 'offline' ? { status: 'reconnecting', attempt: 0, missedChanges: true } : s;
    case 'RETRY':
      return s.status === 'reconnecting' ? { ...s, status: 'reconnecting' } : s;
    case 'CAUGHT_UP':
      return { ...s, missedChanges: false };
  }
}

/** Exponential backoff with a cap: 1s, 2s, 4s … 30s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
}

export const LIVE_LABELS: Record<LiveStatus, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  offline: 'Offline: showing the last update',
};
