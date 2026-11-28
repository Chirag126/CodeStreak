'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** A repository as /api/github/repos returns it (public data only). */
export interface PickerRepo {
  id: number;
  ownerId: number;
  fullName: string;
  description: string | null;
  language: string | null;
  pushedAt: string | null;
  fork: boolean;
  htmlUrl: string;
}

type Load = { status: 'loading' } | { status: 'error'; message: string; notLinked: boolean } | { status: 'ready' };

function updated(iso: string | null): string {
  if (!iso) return 'never pushed';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'pushed today';
  if (days === 1) return 'pushed yesterday';
  if (days < 30) return `pushed ${days} days ago`;
  return `pushed ${new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function RepoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn('size-4 fill-current', className)}>
      <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z" />
    </svg>
  );
}

/**
 * The signed-in user's public GitHub repositories, searchable, newest push first. `single` picks
 * one (individual mode); `multi` toggles up to `max` (shared mode). Private repositories are not
 * listed: GitHub never shows CodeStreak their pushes, so they could never count.
 */
export function RepoPicker({
  mode,
  selected,
  onToggle,
  max = 1,
  allowForks = false,
  disabled = false,
}: {
  mode: 'single' | 'multi';
  /** Selected repositories by full name (case-insensitive). */
  selected: string[];
  onToggle: (repo: PickerRepo) => void;
  max?: number;
  allowForks?: boolean;
  disabled?: boolean;
}) {
  const [repos, setRepos] = useState<PickerRepo[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [query, setQuery] = useState('');

  // Fetches a page; the caller shows "loading" first (the first load starts in that state).
  const fetchPage = useCallback(async (p: number) => {
    try {
      const res = await fetch(`/api/github/repos?page=${p}`, { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as { repos?: PickerRepo[]; hasMore?: boolean; error?: string; code?: string };
      if (!res.ok || !body.repos) {
        setLoad({ status: 'error', message: body.error ?? `Could not load your repositories (HTTP ${res.status}).`, notLinked: body.code === 'github.not_linked' });
        return;
      }
      setRepos((prev) => (p === 1 ? body.repos! : [...prev, ...body.repos!.filter((r) => !prev.some((x) => x.id === r.id))]));
      setHasMore(Boolean(body.hasMore));
      setPage(p);
      setLoad({ status: 'ready' });
    } catch {
      setLoad({ status: 'error', message: 'Could not reach CodeStreak. Check your connection and retry.', notLinked: false });
    }
  }, []);

  useEffect(() => {
    void fetchPage(1);
  }, [fetchPage]);
  const loadPage = (p: number) => {
    setLoad({ status: 'loading' });
    void fetchPage(p);
  };

  const chosen = useMemo(() => new Set(selected.map((s) => s.toLowerCase())), [selected]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return repos.filter((r) => !q || r.fullName.toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q) || (r.language ?? '').toLowerCase().includes(q));
  }, [repos, query]);
  const full = mode === 'multi' && chosen.size >= max;

  if (load.status === 'error' && load.notLinked) {
    return (
      <div role="status" className="rounded-lg border border-warning-400/40 bg-warning-400/10 p-4 text-sm">
        {load.message}{' '}
        <a className="underline underline-offset-4" href="/dashboard/settings">
          Open Settings
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label="Search your repositories"
          placeholder="Search by name, description or language"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={repos.length === 0}
          spellCheck={false}
        />
        {mode === 'multi' && (
          <Badge variant={full ? 'accent' : 'outline'} className="shrink-0">
            {chosen.size} / {max}
          </Badge>
        )}
      </div>

      <div role={mode === 'single' ? 'radiogroup' : 'group'} aria-label="Your public repositories" className="max-h-80 space-y-2 overflow-y-auto pr-1">
        {repos.length === 0 && load.status === 'loading' &&
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-border p-3">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ))}

        {load.status === 'ready' && repos.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            Your GitHub account has no public repositories yet. Create one (or make one public) on GitHub, then retry.
          </p>
        )}
        {repos.length > 0 && visible.length === 0 && <p className="p-2 text-sm text-muted-foreground">No repository matches “{query}”.</p>}

        <AnimatePresence initial={false}>
          {visible.map((r) => {
            const isChosen = chosen.has(r.fullName.toLowerCase());
            const blockedFork = r.fork && !allowForks && mode === 'single';
            const off = disabled || blockedFork || (!isChosen && full);
            return (
              <motion.button
                key={r.id}
                layout="position"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                type="button"
                role={mode === 'single' ? 'radio' : 'checkbox'}
                aria-checked={isChosen}
                disabled={off}
                title={blockedFork ? "Forks don't count in this challenge." : undefined}
                onClick={() => onToggle(r)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
                  isChosen ? 'border-cobalt-400 bg-cobalt-400/10' : 'border-border hover:bg-muted',
                )}
              >
                <RepoIcon className={cn('mt-0.5 shrink-0', isChosen ? 'text-cobalt-300' : 'text-muted-foreground')} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate font-mono text-sm">
                      <span className="text-muted-foreground">{r.fullName.split('/')[0]}/</span>
                      <span className="font-semibold">{r.fullName.split('/')[1]}</span>
                    </span>
                    <Badge variant="outline">Public</Badge>
                    {r.fork && <Badge variant={blockedFork ? 'danger' : 'outline'}>Fork</Badge>}
                  </span>
                  {r.description && <span className="mt-1 block truncate text-xs text-muted-foreground">{r.description}</span>}
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {[r.language, updated(r.pushedAt)].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span aria-hidden className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-xs', isChosen ? 'border-cobalt-400 bg-cobalt-400 text-charcoal-950' : 'border-border')}>
                  {isChosen ? '✓' : ''}
                </span>
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>

      {load.status === 'error' && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive-text">
          {load.message}
          <Button size="sm" variant="outline" onClick={() => loadPage(repos.length ? page + 1 : 1)}>
            Retry
          </Button>
        </div>
      )}
      {hasMore && load.status !== 'error' && (
        <Button size="sm" variant="outline" loading={load.status === 'loading' && repos.length > 0} onClick={() => loadPage(page + 1)}>
          Load more repositories
        </Button>
      )}
      <p className="text-xs text-muted-foreground">Only public repositories are listed: GitHub never shows CodeStreak pushes to private ones, so they could never count.</p>
    </div>
  );
}
