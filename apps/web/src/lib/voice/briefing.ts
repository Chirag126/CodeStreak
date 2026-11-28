import 'server-only';

import { composeBriefing, formatAmount, TOKEN_DECIMALS, type Briefing, type BriefingChallenge, type BriefingProvider, type Token } from '@codestreak/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadClaimCenter } from '@/lib/claims/service';
import { loadDashboard } from '@/lib/dashboard/load';

// Phase 41.2 - the facts behind "Get my update", read with the player's own session (RLS) from the
// same loaders the dashboard uses, so the briefing can never say more than the dashboard shows.
// Claimable amounts come from the chain through the claims service; if that is slow or fails the
// briefing simply doesn't mention claims (it never guesses).

export interface BriefingView extends Briefing {
  /** Facts shown under the text (compact). */
  facts: { label: string; value: string }[];
  generatedAt: number;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

const NONE = '00000000-0000-0000-0000-000000000000';

export async function loadBriefing(supabase: SupabaseClient, profileId: string, now: number): Promise<BriefingView> {
  const view = await loadDashboard(supabase, profileId, now);
  const addresses = view.active.map((a) => a.address).filter((a): a is string => Boolean(a));

  const [{ data: challengeRows }, { count: unreadCount }, { data: latestUnread }, claims] = await Promise.all([
    supabase.from('challenges').select('id, onchain_address, rules').in('onchain_address', addresses.length ? addresses : ['-']),
    supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
    supabase.from('notifications').select('title').is('read_at', null).order('created_at', { ascending: false }).limit(1),
    withTimeout(loadClaimCenter(profileId), 6000),
  ]);

  const byAddress = new Map((challengeRows ?? []).map((c) => [c.onchain_address as string, c]));
  const ids = (challengeRows ?? []).map((c) => c.id as string);
  // Group standing by kept days (verified + shielded), among players the viewer can see.
  const { data: standings } = await supabase
    .from('challenge_standings')
    .select('challenge_id, profile_id, verified_days, shields_used, status')
    .in('challenge_id', ids.length ? ids : [NONE]);

  const rankOf = (challengeId: string): BriefingChallenge['rank'] => {
    const rows = (standings ?? []).filter((s) => s.challenge_id === challengeId);
    const me = rows.find((s) => s.profile_id === profileId);
    if (!me || rows.length < 2) return null;
    const score = (s: (typeof rows)[number]) => Number(s.verified_days ?? 0) + Number(s.shields_used ?? 0);
    return { position: rows.filter((s) => score(s) > score(me)).length + 1, of: rows.length };
  };

  const challenges: BriefingChallenge[] = view.active.map((a) => {
    const row = a.address ? byAddress.get(a.address) : undefined;
    const rules = (row?.rules ?? {}) as { providers?: string[]; providerRule?: string };
    const providers = (rules.providers ?? ['github']).filter((p): p is BriefingProvider => p === 'github' || p === 'leetcode');
    const starting = a.countdownLabel === 'Starts';
    return {
      title: a.title,
      href: a.address ? `/challenges/${a.address}` : null,
      phase: starting ? 'starting' : 'running',
      day: starting ? null : a.day,
      numDays: a.numDays,
      secsLeft: Math.max(0, a.countdownTo - now),
      today: a.today,
      providers: providers.length ? providers : ['github'],
      providerRule: rules.providerRule === 'all' ? 'all' : 'any',
      rank: row ? rankOf(row.id as string) : null,
    };
  });

  const claimable = claims
    ? claims.rows.filter((r) => r.state === 'claimable').map((r) => `${formatAmount(BigInt(r.amount), TOKEN_DECIMALS[r.token as Token])} ${r.token.toUpperCase()}`)
    : null;

  const briefing = composeBriefing({
    streak: { current: view.streak.current, longest: view.streak.longest },
    challenges,
    claimable,
    unread: { count: unreadCount ?? 0, latest: (latestUnread?.[0]?.title as string | undefined) ?? null },
    linked: view.linked,
  });

  const primary = challenges.find((c) => c.phase === 'running') ?? challenges[0];
  const facts: BriefingView['facts'] = [
    { label: 'Streak', value: `${view.streak.current} day${view.streak.current === 1 ? '' : 's'}` },
    { label: 'Active', value: String(challenges.length) },
  ];
  if (primary) facts.push({ label: primary.phase === 'starting' ? 'Starts in' : 'Day ends in', value: compactDuration(primary.secsLeft) });
  if (claimable?.length) facts.push({ label: 'To claim', value: claimable.join(' + ') });

  return { ...briefing, facts, generatedAt: now };
}

function compactDuration(secs: number): string {
  if (secs < 60) return '<1m';
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}
