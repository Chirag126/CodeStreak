'use client';

import { BOARD_LABELS, rankChanges, type BoardKind, type Token } from '@codestreak/shared';
import { ArrowDown, ArrowUp, Sparkles } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { initialLive, liveReducer, retryDelayMs, type LiveEvent } from '@/lib/board/live';
import type { BoardView, LeaderboardData } from '@/lib/leaderboards/load';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

const STATUS_EVENTS = new Set(['SUBSCRIBED', 'CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']);
const TABS: { kind: BoardKind; token?: Token; label: string }[] = [
  { kind: 'weekly', label: 'This week' },
  { kind: 'streak', label: 'Longest streak' },
  { kind: 'consistent', label: 'Most consistent' },
  { kind: 'earners', token: 'usdc', label: 'Top earners · USDC' },
  { kind: 'earners', token: 'sol', label: 'Top earners · SOL' },
];
const tabKey = (t: { kind: BoardKind; token?: Token }) => `${t.kind}:${t.token ?? ''}`;

/**
 * Live leaderboards: Supabase Realtime on challenge_activity (bumped by every recorded day,
 * membership, payout and challenge change; RLS-filtered), re-fetch debounced, resubscribe with
 * backoff, catch up after any disconnect or when the tab comes back.
 */
function useLiveLeaderboards(initial: LeaderboardData) {
  const [data, setData] = useState(initial);
  const [live, dispatch] = useReducer(liveReducer, initialLive);
  const [generation, setGeneration] = useState(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const missed = useRef(false);
  const group = initial.scope.kind === 'group' ? initial.scope : null;

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`/api/leaderboards${group ? `?group=${group.address}` : ''}`, { cache: 'no-store' });
      if (res.ok) setData((await res.json()) as LeaderboardData);
      return res.ok;
    } catch {
      return false;
    }
  }, [group]);

  const schedule = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current);
    // Global boards hear every challenge: batch bursts (a worker run records many days at once).
    debounce.current = setTimeout(() => void refetch(), group ? 300 : 1200);
  }, [refetch, group]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let disposed = false;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void (async () => {
      const { data: s } = await supabase.auth.getSession();
      if (s.session) await supabase.realtime.setAuth(s.session.access_token);
      if (disposed) return;
      const filter = group ? { filter: `challenge_id=eq.${group.challengeId}` } : {};
      channel = supabase
        .channel(`leaderboards:${group?.challengeId ?? 'global'}:${generation}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'challenge_activity', ...filter }, () => schedule())
        .subscribe((status) => {
          if (disposed || !STATUS_EVENTS.has(status)) return;
          dispatch({ type: status } as LiveEvent);
          if (status !== 'SUBSCRIBED') missed.current = true;
          else if (missed.current) {
            missed.current = false;
            void refetch().then((ok) => ok && dispatch({ type: 'CAUGHT_UP' }));
          }
        });
    })();
    return () => {
      disposed = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [group, generation, schedule, refetch]);

  useEffect(() => {
    if (live.status !== 'reconnecting') return;
    const t = setTimeout(() => setGeneration((g) => g + 1), retryDelayMs(live.attempt));
    return () => clearTimeout(t);
  }, [live.status, live.attempt]);

  useEffect(() => {
    const offline = () => {
      missed.current = true;
      dispatch({ type: 'OFFLINE' });
    };
    const online = () => dispatch({ type: 'ONLINE' });
    const visible = () => document.visibilityState === 'visible' && schedule();
    // "This week" rolls over on Monday 00:00 UTC even without activity: re-rank every 5 minutes.
    const id = setInterval(() => document.visibilityState === 'visible' && void refetch(), 300_000);
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(id);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      document.removeEventListener('visibilitychange', visible);
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [schedule, refetch]);

  return { data, live };
}

function Board({ board }: { board: BoardView }) {
  const reduce = useReducedMotion();
  // Ranks from the previous data, per board, to show ▲/▼ for a few seconds after a change.
  const prev = useRef<Map<string, number> | null>(null);
  const [moves, setMoves] = useState<Map<string, number | null>>(new Map());
  const ranks = board.entries.map((e) => `${e.profileId}:${e.rank}`).join(',');

  useEffect(() => {
    const before = prev.current;
    prev.current = new Map(board.entries.map((e) => [e.profileId, e.rank]));
    if (!before) return; // first render: nothing moved
    const changed = new Map([...rankChanges(before, board.entries)].filter(([, d]) => d !== 0));
    if (!changed.size) return;
    const show = setTimeout(() => setMoves(changed), 0);
    const hide = setTimeout(() => setMoves(new Map()), 4000);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
    // Re-run only when the ranking itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranks]);

  if (!board.entries.length) {
    return <p className="py-10 text-center text-sm text-muted-foreground">Nobody on this board yet. Recorded days and payouts put players here.</p>;
  }
  return (
    <LayoutGroup>
      <ol className="divide-y divide-border">
        <AnimatePresence initial={false}>
          {board.entries.map((e) => {
            const move = moves.get(e.profileId);
            return (
              <motion.li
                key={e.profileId}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, backgroundColor: move ? 'rgba(61,220,132,0.08)' : 'rgba(0,0,0,0)' }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, x: -12 }}
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                className="flex items-center gap-3 px-2 py-2.5"
              >
                <span className={`w-8 text-right font-mono text-sm tabular-nums ${e.rank <= 3 ? 'font-bold' : 'text-muted-foreground'}`}>
                  {e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : `#${e.rank}`}
                </span>
                <div className="min-w-0 flex-1">
                  {e.username ? (
                    <Link className="block truncate font-medium hover:underline" href={`/u/${e.username}`}>
                      {e.name}
                    </Link>
                  ) : (
                    <p className="truncate font-medium">{e.name}</p>
                  )}
                  <p className="truncate text-xs text-muted-foreground">
                    {e.username && e.name !== `@${e.username}` ? `@${e.username} · ` : ''}
                    {e.detail}
                  </p>
                </div>
                <AnimatePresence>
                  {move !== undefined && (
                    <motion.span initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} aria-live="polite">
                      {move === null ? (
                        <Badge variant="accent">
                          <Sparkles className="size-3" aria-hidden /> New
                        </Badge>
                      ) : move > 0 ? (
                        <Badge variant="success">
                          <ArrowUp className="size-3" aria-hidden /> {move}
                        </Badge>
                      ) : (
                        <Badge variant="danger">
                          <ArrowDown className="size-3" aria-hidden /> {-move}
                        </Badge>
                      )}
                    </motion.span>
                  )}
                </AnimatePresence>
                <span className="font-mono text-base font-semibold tabular-nums">{e.score}</span>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </LayoutGroup>
  );
}

export interface GroupOption {
  address: string;
  title: string;
  state: 'running' | 'finished' | 'cancelled';
  /** YYYY-MM-DD (UTC). */
  startDay: string;
}

const GROUP_LABEL: Record<GroupOption['state'], string> = { running: 'Running', finished: 'Finished', cancelled: 'Cancelled' };

/** Global / one of your groups: a switch plus one tidy dropdown instead of a wall of chips. */
function ScopePicker({ current, groups }: { current: string; groups: GroupOption[] }) {
  const router = useRouter();
  const isGlobal = current === 'global';
  const firstGroup = groups.find((g) => g.state === 'running') ?? groups[0];
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="radiogroup" aria-label="Leaderboard scope" className="inline-flex rounded-lg bg-muted p-1">
        <Link
          href="/leaderboards"
          role="radio"
          aria-checked={isGlobal}
          className={`rounded-md px-4 py-1.5 text-sm transition-colors ${isGlobal ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Global
        </Link>
        {firstGroup ? (
          <Link
            href={`/leaderboards?group=${isGlobal ? firstGroup.address : current}`}
            role="radio"
            aria-checked={!isGlobal}
            className={`rounded-md px-4 py-1.5 text-sm transition-colors ${!isGlobal ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            My groups
          </Link>
        ) : (
          <span className="cursor-not-allowed rounded-md px-4 py-1.5 text-sm text-muted-foreground/60" title="Join a challenge to see its group board">
            My groups
          </span>
        )}
      </div>
      {!isGlobal && groups.length > 0 && (
        <label className="flex min-w-0 items-center gap-2 text-sm">
          <span className="sr-only">Group</span>
          <select
            value={current}
            onChange={(e) => router.push(`/leaderboards?group=${e.target.value}`)}
            className="h-9 max-w-[22rem] min-w-0 truncate rounded-md border border-input bg-background px-2 text-sm"
          >
            {(['running', 'finished', 'cancelled'] as const).map((state) => {
              const items = groups.filter((g) => g.state === state);
              if (!items.length) return null;
              return (
                <optgroup key={state} label={GROUP_LABEL[state]}>
                  {items.map((g) => (
                    <option key={g.address} value={g.address}>
                      {g.title} · {g.startDay}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>
      )}
    </div>
  );
}

const MEDAL = ['🥇', '🥈', '🥉'];

/** Top three as a podium (2 · 1 · 3), then the rest as an aligned table. */
function Podium({ board }: { board: BoardView }) {
  const top = board.entries.filter((e) => e.rank <= 3).slice(0, 3);
  if (top.length < 2) return null;
  const order = top.length === 3 ? [top[1]!, top[0]!, top[2]!] : top;
  return (
    <div className={`grid gap-3 ${order.length === 3 ? 'grid-cols-3' : 'grid-cols-2'} items-end`}>
      {order.map((e) => (
        <div
          key={e.profileId}
          className={`flex flex-col items-center gap-1 rounded-xl border border-border bg-muted/30 px-2 text-center ${e.rank === 1 ? 'py-5' : 'py-3'}`}
        >
          <span className={e.rank === 1 ? 'text-3xl' : 'text-2xl'} aria-hidden>
            {MEDAL[e.rank - 1]}
          </span>
          <span className="w-full truncate text-sm font-medium">{e.name}</span>
          <span className="font-mono text-lg font-semibold tabular-nums">{e.score}</span>
          <span className="w-full truncate text-xs text-muted-foreground">{e.detail}</span>
        </div>
      ))}
    </div>
  );
}

export function LiveLeaderboards({ initial, groups }: { initial: LeaderboardData; groups: GroupOption[] }) {
  const { data, live } = useLiveLeaderboards(initial);
  const [tab, setTab] = useState(tabKey(TABS[0]!));
  const board = data.boards.find((b) => tabKey(b) === tab) ?? data.boards[0]!;
  const current = data.scope.kind === 'group' ? data.scope.address : 'global';
  const scopeTitle = data.scope.kind === 'group' ? data.scope.title : 'Global';

  return (
    <div className="space-y-5">
      <ScopePicker current={current} groups={groups} />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="min-w-0 space-y-1">
            <CardTitle className="truncate text-xl">{scopeTitle}</CardTitle>
            <CardDescription>
              {data.scope.kind === 'group' ? 'Players in this challenge only.' : 'Everyone in public challenges. Private groups never appear here.'}
            </CardDescription>
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
            <span className={`inline-flex size-2 rounded-full ${live.status === 'live' ? 'bg-electric-400' : 'bg-warning-400'}`} />
            {live.status === 'live' ? 'Live' : live.status === 'connecting' ? 'Connecting…' : 'Reconnecting…'} · {data.players} player{data.players === 1 ? '' : 's'}
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div role="tablist" aria-label="Leaderboard" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 sm:grid-cols-5">
            {TABS.map((t) => (
              <button
                key={tabKey(t)}
                role="tab"
                type="button"
                aria-selected={tab === tabKey(t)}
                onClick={() => setTab(tabKey(t))}
                className={`truncate rounded-md px-2 py-1.5 text-sm transition-colors ${tab === tabKey(t) ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{BOARD_LABELS[board.kind].rule}</p>
          <Podium board={board} />
          <Board key={`${current}:${tab}`} board={board} />
        </CardContent>
      </Card>
    </div>
  );
}
