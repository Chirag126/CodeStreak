import type { Metadata } from 'next';
import Link from 'next/link';
import { ChallengeCard, type OverviewRow } from '@/components/challenges/challenge-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createSupabaseServerClient, getViewer } from '@/lib/supabase/server';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Challenges' };
export const dynamic = 'force-dynamic';

const FILTERS = {
  status: [
    { value: 'all', label: 'All' },
    { value: 'joining', label: 'Joining open' },
    { value: 'running', label: 'Running' },
    { value: 'finished', label: 'Finished' },
  ],
  token: [
    { value: 'all', label: 'Any token' },
    { value: 'usdc', label: 'USDC' },
    { value: 'sol', label: 'SOL' },
  ],
  length: [
    { value: 'all', label: 'Any length' },
    { value: '3', label: '3 days' },
    { value: '7', label: '7 days' },
    { value: '14', label: '14 days' },
    { value: '30', label: '30 days' },
    { value: 'demo', label: 'Demo' },
  ],
} as const;

type Params = { status?: string; token?: string; length?: string; q?: string };
const pick = <T extends readonly { value: string }[]>(options: T, value: string | undefined) => (options.some((o) => o.value === value) ? value! : 'all');

function hrefWith(params: Params, patch: Params): string {
  const merged = { ...params, ...patch };
  const qs = new URLSearchParams(Object.entries(merged).filter(([, v]) => v && v !== 'all') as [string, string][]);
  const s = qs.toString();
  return s ? `/challenges?${s}` : '/challenges';
}

/** Current time for this request (a helper, so render stays free of clock reads). */
const requestTime = () => new Date();

export default async function ChallengesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const raw = await searchParams;
  const params: Params = {
    status: pick(FILTERS.status, raw.status),
    token: pick(FILTERS.token, raw.token),
    length: pick(FILTERS.length, raw.length),
    q: (raw.q ?? '').trim().slice(0, 80),
  };
  const now = requestTime();
  const nowIso = now.toISOString();

  // RLS + security_invoker view: public challenges, plus private ones the viewer created, joined or was invited to.
  const supabase = await createSupabaseServerClient();
  let query = supabase.from('challenge_overview').select('*').not('onchain_address', 'is', null);
  if (params.status === 'joining') query = query.eq('pool_state', 'open').gt('join_deadline_at', nowIso);
  if (params.status === 'running') query = query.eq('pool_state', 'open').lte('start_at', nowIso).gt('end_at', nowIso);
  if (params.status === 'finished') query = query.or(`pool_state.neq.open,end_at.lte.${nowIso}`);
  if (params.token !== 'all') query = query.eq('token', params.token!);
  if (params.length === 'demo') query = query.eq('is_demo', true);
  else if (params.length !== 'all') query = query.eq('is_demo', false).eq('num_days', Number(params.length));
  if (params.q) query = query.ilike('title', `%${params.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
  query = params.status === 'joining' ? query.order('join_deadline_at', { ascending: true }) : query.order('created_at', { ascending: false });
  const { data, error } = await query.limit(60);
  const rows = (data ?? []) as OverviewRow[];
  const viewer = await getViewer();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold tracking-tight">Challenges</h1>
          <p className="text-sm text-muted-foreground">Live on Solana devnet. Pools and players come from the chain; DEMO challenges use compressed days.</p>
        </div>
        <Button asChild>
          <Link href={viewer ? '/challenges/new' : '/sign-in?next=/challenges/new'}>Create a challenge</Link>
        </Button>
      </div>

      <div className="space-y-3">
        {(['status', 'token', 'length'] as const).map((key) => (
          <nav key={key} aria-label={`Filter by ${key}`} className="flex flex-wrap gap-2">
            {FILTERS[key].map((o) => {
              const active = params[key] === o.value;
              return (
                <Link
                  key={o.value}
                  href={hrefWith(params, { [key]: o.value })}
                  aria-current={active ? 'true' : undefined}
                  className={cn('rounded-full border px-3 py-1 text-xs', active ? 'border-cobalt-400 bg-cobalt-400/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground')}
                >
                  {o.label}
                </Link>
              );
            })}
          </nav>
        ))}
        <form action="/challenges" method="get" className="flex max-w-md gap-2" role="search">
          {(['status', 'token', 'length'] as const).map((k) => params[k] !== 'all' && <input key={k} type="hidden" name={k} value={params[k]} />)}
          <Input name="q" defaultValue={params.q} placeholder="Search by title" aria-label="Search by title" maxLength={80} />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive-text">
          Could not load challenges. Please refresh.
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">No challenges match these filters.</p>
          <Link href="/challenges" className="mt-2 inline-block text-sm underline underline-offset-4">
            Clear filters
          </Link>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <li key={row.id}>
              <ChallengeCard row={row} now={now} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
