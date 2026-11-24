'use client';

import { BOARD_LABELS, rankChanges, type BoardKind, type Token } from '@codestreak/shared';
import { ArrowDown, ArrowUp, Sparkles } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
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
                  <p className="truncate font-medium">{e.name}</p>
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

export function LiveLeaderboards({ initial, groups }: { initial: LeaderboardData; groups: { address: string; title: string }[] }) {
  const { data, live } = useLiveLeaderboards(initial);
  const [tab, setTab] = useState(tabKey(TABS[0]!));
  const board = data.boards.find((b) => tabKey(b) === tab) ?? data.boards[0]!;
  const current = data.scope.kind === 'group' ? data.scope.address : 'global';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Scope" className="flex flex-wrap gap-2">
          <Link href="/leaderboards" className={`rounded-full border px-3 py-1 text-sm ${current === 'global' ? 'border-electric-400 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>
            Global
          </Link>
          {groups.map((g) => (
            <Link
              key={g.address}
              href={`/leaderboards?group=${g.address}`}
              className={`max-w-[14rem] truncate rounded-full border px-3 py-1 text-sm ${current === g.address ? 'border-electric-400 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
            >
              {g.title}
            </Link>
          ))}
        </nav>
        <p className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <span className={`inline-flex size-2 rounded-full ${live.status === 'live' ? 'bg-electric-400' : 'bg-warning-400'}`} />
          {live.status === 'live' ? 'Live' : live.status === 'connecting' ? 'Connecting…' : 'Reconnecting… (showing the last update)'} · {data.players} player{data.players === 1 ? '' : 's'}
        </p>
      </div>

      <div role="tablist" aria-label="Leaderboard" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
        {TABS.map((t) => (
          <button
            key={tabKey(t)}
            role="tab"
            type="button"
            aria-selected={tab === tabKey(t)}
            onClick={() => setTab(tabKey(t))}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${tab === tabKey(t) ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {BOARD_LABELS[board.kind].title}
            {board.token ? ` · ${board.token.toUpperCase()}` : ''}
            {data.scope.kind === 'group' ? ` · ${data.scope.title}` : ' · Global'}
          </CardTitle>
          <CardDescription>
            {BOARD_LABELS[board.kind].rule} {data.scope.kind === 'global' ? 'Global boards count public challenges only.' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Board key={`${current}:${tab}`} board={board} />
        </CardContent>
      </Card>
    </div>
  );
}
