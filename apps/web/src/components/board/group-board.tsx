'use client';

import { buildBoard, formatAmount, formatCountdown, type BoardMember, type CellState } from '@codestreak/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useState, useTransition } from 'react';
import { useToast } from '@/components/feedback/toaster';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { setBoardVisibilityAction, setShareChecksAction } from '@/app/challenges/[address]/board-actions';
import type { BoardPayload } from '@/lib/board/load';
import { LIVE_LABELS } from '@/lib/board/live';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useLiveBoard, useNowSecs } from './use-live-board';
import { ViewChecks } from './view-checks';

const CELL_STYLE: Record<CellState, string> = {
  verified: 'bg-electric-400',
  failed: 'bg-danger-400',
  shielded: 'bg-cobalt-400',
  indeterminate: 'bg-warning-400/70',
  today: 'bg-transparent ring-2 ring-inset ring-electric-400/70 animate-pulse',
  pending: 'bg-muted border border-dashed border-muted-foreground/40',
  upcoming: 'bg-muted/40',
};

const CELL_LABEL: Record<CellState, string> = {
  verified: 'verified',
  failed: 'missed',
  shielded: 'covered by a Shield',
  indeterminate: "couldn't be checked (provider outage): stake safe",
  today: 'today: not verified yet',
  pending: 'waiting for the check',
  upcoming: 'not started',
};

const STATE_BADGE = {
  in: { variant: 'primary', label: 'Still in' },
  out: { variant: 'danger', label: 'Out' },
  survived: { variant: 'success', label: 'Survived' },
  voided: { variant: 'warning', label: 'Refunded' },
} as const;

const LIVE_DOT = { live: 'bg-electric-400', connecting: 'bg-muted-foreground', reconnecting: 'bg-warning-400 animate-pulse', offline: 'bg-danger-400' } as const;

function checksText(m: BoardMember, day: number | null): string | null {
  if (!m.checks) return m.isViewer ? null : 'check details private';
  const today = day === null ? undefined : m.checks.find((c) => c.day === day);
  if (!today) return day === null ? null : 'not checked today';
  if (today.progress?.length) {
    return today.progress
      .slice()
      .sort((a, b) => a.provider.localeCompare(b.provider))
      .map((p) => `${p.value}/${p.goal} ${p.provider === 'github' ? 'lines' : 'new problems'}${p.outcome === 'met' ? ' ✓' : ''}`)
      .join(' · ')
      .concat(' today');
  }
  if (today.lines !== undefined && today.goal) return `${today.lines}/${today.goal} lines today${today.outcome === 'met' ? ' ✓' : ''}`;
  return `${today.counted}/${today.considered} commits counted`;
}

export function GroupBoard({ address, initial, initialNow, decimals, symbol }: { address: string; initial: BoardPayload; initialNow: number; decimals: number; symbol: string }) {
  const { payload, live, refetch } = useLiveBoard(address, initial.challengeId, initial);
  const now = useNowSecs(initialNow);
  const board = buildBoard(payload.input, now);
  const { input, viewer } = payload;
  const toast = useToast();
  const [busy, start] = useTransition();
  const [share, setShare] = useState(viewer.shareChecks);

  function changeVisibility(v: 'viewers' | 'participants') {
    start(async () => {
      const r = await setBoardVisibilityAction(payload.challengeId, v);
      if (!r.ok) toast({ kind: 'error', title: 'Not saved', message: r.error });
      await refetch();
    });
  }

  function changeShare(v: boolean) {
    setShare(v);
    start(async () => {
      const r = await setShareChecksAction(viewer.membershipId!, v);
      if (!r.ok) {
        setShare(!v);
        toast({ kind: 'error', title: 'Not saved', message: r.error });
      }
      await refetch();
    });
  }

  const remaining = board.countdown ? board.countdown.targetTs - now : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Group board</CardTitle>
          <Badge variant="primary">{board.statusLabel}</Badge>
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status" aria-live="polite">
            <span className={cn('size-2 rounded-full', LIVE_DOT[live.status])} aria-hidden />
            {LIVE_LABELS[live.status]}
          </span>
        </div>
        <CardDescription>
          {board.countdown && remaining !== null ? (
            <>
              {board.countdown.label} in <span className="font-mono tabular-nums text-foreground">{formatCountdown(remaining)}</span>
              {board.day !== null && ` · day ${board.day + 1} of ${board.numDays}`}
            </>
          ) : (
            'No more deadlines.'
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <div><dt className="text-muted-foreground">Pool</dt><dd className="font-mono">{formatAmount(BigInt(input.poolTotal), decimals)} {symbol}</dd></div>
          <div><dt className="text-muted-foreground">Players</dt><dd>{board.memberCount} / {input.maxParticipants} <span className="text-muted-foreground">(min {input.minParticipants})</span></dd></div>
          <div><dt className="text-muted-foreground">Still in</dt><dd><motion.span key={board.stillIn} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }}>{input.membersVisible ? board.stillIn : '–'}</motion.span></dd></div>
          <div><dt className="text-muted-foreground">Survived · Out</dt><dd>{input.membersVisible ? `${board.survived} · ${board.out}` : '–'}</dd></div>
          <div><dt className="text-muted-foreground">Done today</dt><dd>{board.day === null || !input.membersVisible ? '–' : `${board.doneToday} / ${board.stillIn + board.out}`}</dd></div>
        </dl>

        {!input.membersVisible ? (
          <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">The creator shows the member board to players only.</p>
        ) : board.members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No players yet.</p>
        ) : (
          <ul className="space-y-2" aria-label="Members">
            <AnimatePresence initial={false}>
              {board.members.map((m) => (
                <motion.li
                  key={m.membershipId}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: m.state === 'out' ? 0.6 : 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={springs.gentle}
                  className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border p-3', m.isViewer && 'border-electric-400/40')}
                >
                  <div className="min-w-40 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {m.name}
                      {m.isViewer && <Badge variant="accent">You</Badge>}
                      {m.isCreator && <Badge variant="outline">Creator</Badge>}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {m.publicId}
                      {(() => {
                        const t = checksText(m, board.day);
                        return t ? <span className="ml-2 font-sans">· {t}</span> : null;
                      })()}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1" role="list" aria-label={`${m.name}'s days`}>
                    {m.cells.map((c, d) => (
                      <Tooltip key={d}>
                        <TooltipTrigger asChild>
                          <motion.span
                            role="listitem"
                            aria-label={`Day ${d + 1}: ${CELL_LABEL[c]}`}
                            key={`${d}-${c}`}
                            initial={{ scale: 0.6, opacity: 0.4 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={springs.snappy}
                            className={cn('block size-4 rounded-[4px]', CELL_STYLE[c])}
                          />
                        </TooltipTrigger>
                        <TooltipContent>Day {d + 1}: {CELL_LABEL[c]}</TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {m.checks && board.day !== null && m.checks.some((c) => c.day === board.day) && <ViewChecks membershipId={m.membershipId} name={m.name} day={board.day} />}
                    {m.shieldsUsed > 0 && <span>{m.shieldsUsed} Shield{m.shieldsUsed > 1 ? 's' : ''}</span>}
                    <Badge variant={STATE_BADGE[m.state].variant}>{STATE_BADGE[m.state].label}</Badge>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {(['verified', 'failed', 'shielded', 'indeterminate', 'today', 'pending'] as const).map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5">
              <span className={cn('inline-block size-3 rounded-[3px]', CELL_STYLE[c].replace('animate-pulse', ''))} aria-hidden />
              {CELL_LABEL[c].split(':')[0]}
            </span>
          ))}
        </div>

        {(viewer.isCreator || viewer.membershipId) && (
          <div className="flex flex-wrap gap-6 border-t border-border pt-4">
            {viewer.isCreator && (
              <div className="space-y-1">
                <Label htmlFor="board-visibility" className="text-xs">Who sees the member board</Label>
                <select
                  id="board-visibility"
                  value={input.boardVisibility}
                  disabled={busy}
                  onChange={(e) => changeVisibility(e.target.value as 'viewers' | 'participants')}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                >
                  <option value="viewers">Everyone who can see this challenge</option>
                  <option value="participants">Players only</option>
                </select>
              </div>
            )}
            {viewer.membershipId && (
              <div className="flex items-center gap-2">
                <Switch id="share-checks" checked={share} onCheckedChange={changeShare} disabled={busy} />
                <Label htmlFor="share-checks" className="text-xs">Show my check details to others (day results are always shown)</Label>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
