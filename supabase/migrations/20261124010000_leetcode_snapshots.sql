-- Phase 26 - LeetCode provider: snapshots of each linked LeetCode profile over time.
-- One snapshot serves all of a person's challenges. Server-only (RLS on, no policies, no grants):
-- what a viewer may see is published through evidence / member_day_checks (with their own rules).

create type public.snapshot_source as enum ('join', 'scheduled', 'manual');

create table public.leetcode_snapshots (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  handle text not null check (handle ~ '^[a-z0-9_-]{1,40}$'),
  observed_at timestamptz not null default now(),
  source public.snapshot_source not null,
  -- false: Firecrawl or LeetCode couldn't be read (the day then can't fail on this snapshot)
  readable boolean not null,
  solved integer check (solved >= 0),
  easy integer check (easy >= 0),
  medium integer check (medium >= 0),
  hard integer check (hard >= 0),
  has_history boolean not null default false,
  -- [{ "id": "2201018865", "title": "Count Dominant Elements", "ago": "a day ago" }], newest first
  recent jsonb not null default '[]' check (jsonb_typeof(recent) = 'array' and jsonb_array_length(recent) <= 40),
  error text check (char_length(error) <= 300),
  check (readable or (solved is null and jsonb_array_length(recent) = 0))
);
create index leetcode_snapshots_profile_time on public.leetcode_snapshots (profile_id, observed_at desc);
alter table public.leetcode_snapshots enable row level security;
revoke all on public.leetcode_snapshots from anon, authenticated;

/**
 * Who needs a scheduled snapshot now: people with a linked LeetCode account who are in a challenge
 * that counts LeetCode, from 1 hour before it starts until its final checks close, and whose
 * newest snapshot is older than `max_age`. Service role only (the worker).
 */
create or replace function public.leetcode_snapshot_targets(max_age interval default interval '25 minutes', max_rows integer default 25)
returns table (profile_id uuid, handle text)
language sql stable security definer set search_path = '' as $$
  select distinct on (la.profile_id) la.profile_id, la.provider_user_id
  from public.memberships m
  join public.challenges c on c.id = m.challenge_id
  join public.linked_accounts la on la.profile_id = m.profile_id and la.provider = 'leetcode'
  where m.status = 'active'
    and c.pool_state = 'open'
    and c.rules -> 'providers' ? 'leetcode'
    and now() >= c.start_at - interval '1 hour'
    and now() < c.start_at + make_interval(secs => c.num_days::double precision * c.day_length_secs + c.verify_window_secs)
    and not exists (
      select 1 from public.leetcode_snapshots s
      where s.profile_id = la.profile_id and s.observed_at > now() - max_age
    )
  order by la.profile_id
  limit greatest(1, least(max_rows, 100));
$$;
revoke all on function public.leetcode_snapshot_targets(interval, integer) from public, anon, authenticated;
grant execute on function public.leetcode_snapshot_targets(interval, integer) to service_role;

-- Every 30 minutes (offset from the wake job), only on Supabase.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('codestreak-leetcode-snapshots', '15,45 * * * *', $job$select private.wake_worker('leetcode-snapshots')$job$);
  else
    raise notice 'pg_cron not available: LeetCode snapshot schedule not created (expected outside Supabase)';
  end if;
end $$;
