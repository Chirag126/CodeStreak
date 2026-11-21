-- Phase 11 - Schema B: verification runs, evidence, day results, receipts, disputes, audit log,
-- voice clips, badges, leaderboard views. RLS on every table. Also clears the Phase 10 advisor
-- warnings (mutable search_path, SECURITY DEFINER helpers exposed through the API, unindexed FKs).

-- ---------------------------------------------------------------- private schema for helpers
-- Not exposed by the Data API, so these SECURITY DEFINER helpers can't be called as /rpc/...;
-- RLS policies still call them.
create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

create or replace function private.can_view_challenge(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.challenges c
    where c.id = target
      and (
        c.visibility = 'public'
        or c.creator_id = (select auth.uid())
        or exists (select 1 from public.memberships m where m.challenge_id = c.id and m.profile_id = (select auth.uid()))
        or exists (
          select 1 from public.invitations i
          where i.challenge_id = c.id and i.invitee_id = (select auth.uid()) and i.status in ('pending', 'accepted')
        )
      )
  );
$$;

create or replace function private.can_view_membership(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m
    where m.id = target and private.can_view_challenge(m.challenge_id)
  );
$$;

revoke all on function private.can_view_challenge(uuid) from public;
revoke all on function private.can_view_membership(uuid) from public;
grant execute on function private.can_view_challenge(uuid) to anon, authenticated, service_role;
grant execute on function private.can_view_membership(uuid) to anon, authenticated, service_role;

-- Re-point the Phase 10 policies at the private helper, then drop the exposed one.
drop policy "visible challenges" on public.challenges;
drop policy "members of visible challenges" on public.memberships;
drop policy "sponsors of visible challenges" on public.sponsorships;
drop policy "shields of visible challenges" on public.shields;
drop function public.can_view_challenge(uuid);

create policy "visible challenges" on public.challenges for select to anon, authenticated
  using (private.can_view_challenge(id));
create policy "members of visible challenges" on public.memberships for select to anon, authenticated
  using (private.can_view_challenge(challenge_id));
create policy "sponsors of visible challenges" on public.sponsorships for select to anon, authenticated
  using (private.can_view_challenge(challenge_id));
create policy "shields of visible challenges" on public.shields for select to anon, authenticated
  using (private.can_view_membership(membership_id));

-- Fixed search_path on the Phase 10 functions.
alter function public.set_updated_at() set search_path = '';
alter function public.generate_public_id() set search_path = '';

-- Supabase creates public.rls_auto_enable() (an event-trigger helper) in new projects; it must not
-- be callable through the API. Absent in plain Postgres (CI), hence the guard.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- Phase 10 foreign keys without a covering index.
create index invitations_invited_by on public.invitations (invited_by);
create index sponsorships_sponsor on public.sponsorships (sponsor_id);

-- ---------------------------------------------------------------- types

create type public.run_status as enum ('running', 'succeeded', 'partial', 'failed');
create type public.run_trigger as enum ('scheduled', 'manual', 'dispute');
create type public.evidence_kind as enum ('commit', 'submission');
create type public.day_result as enum ('verified', 'failed', 'indeterminate');
create type public.result_source as enum ('worker', 'dispute');
create type public.receipt_kind as enum ('join', 'sponsor', 'shield', 'reward', 'refund', 'sponsor_refund');
create type public.dispute_status as enum ('open', 'accepted', 'rejected', 'withdrawn');
create type public.actor_kind as enum ('user', 'worker', 'relayer', 'admin', 'system');
create type public.voice_clip_kind as enum ('morning', 'nudge', 'recap', 'celebration');

-- ---------------------------------------------------------------- verification runs

create table public.verification_runs (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  day smallint not null check (day between 0 and 59),
  triggered_by public.run_trigger not null,
  status public.run_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  checked_count integer not null default 0 check (checked_count >= 0),
  error text check (char_length(error) <= 2000),
  check ((status = 'running') = (finished_at is null)),
  check (finished_at is null or finished_at >= started_at)
);
create index verification_runs_challenge_day on public.verification_runs (challenge_id, day);

-- ---------------------------------------------------------------- evidence
-- What the verifier saw: one row per commit / accepted submission considered for a day.

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships (id) on delete cascade,
  run_id uuid references public.verification_runs (id) on delete set null,
  day smallint not null check (day between 0 and 59),
  provider public.provider not null,
  kind public.evidence_kind not null,
  external_id text not null check (char_length(external_id) between 1 and 128),  -- commit SHA / submission ID
  occurred_at timestamptz not null,                     -- push time (GitHub) / submission time (LeetCode)
  diff_hash text check (diff_hash ~ '^[0-9a-f]{64}$'),  -- normalized-diff SHA-256 (anti-duplicate)
  counted boolean not null,
  reason text not null check (char_length(reason) between 1 and 200),  -- why it did or didn't count
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (membership_id, provider, external_id),       -- a commit/submission is considered once
  check (kind = 'commit' or diff_hash is null),
  check ((provider = 'github') = (kind = 'commit'))
);
-- The same change re-pushed (new SHA, same diff) never counts twice for a member.
create unique index evidence_counted_diff_once on public.evidence (membership_id, diff_hash) where counted and diff_hash is not null;
create index evidence_run on public.evidence (run_id);

-- ---------------------------------------------------------------- day results
-- Mirror of the on-chain result per member-day, with the program's one-way rules.

create table public.day_results (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships (id) on delete cascade,
  day smallint not null check (day between 0 and 59),
  result public.day_result not null,
  source public.result_source not null default 'worker',
  evidence_count integer not null default 0 check (evidence_count >= 0),
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),   -- the hash recorded on-chain
  record_tx public.tx_signature unique,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (membership_id, day)
);
create trigger day_results_updated_at before update on public.day_results
  for each row execute function public.set_updated_at();

create or replace function private.enforce_day_result_rules() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.membership_id <> old.membership_id or new.day <> old.day then
    raise exception 'membership and day of a result are fixed' using errcode = '23514';
  end if;
  if old.result = 'verified' and new.result <> 'verified' then
    raise exception 'a verified day is final' using errcode = '23514';
  end if;
  if new.result <> old.result and new.result <> 'verified' then
    raise exception 'results can only be upgraded to verified' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger day_results_one_way before update on public.day_results
  for each row execute function private.enforce_day_result_rules();

-- ---------------------------------------------------------------- receipts
-- Every confirmed on-chain money movement, for each user's history.

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,   -- null: anonymous sponsor
  wallet public.solana_address not null,
  kind public.receipt_kind not null,
  amount public.u64 not null check (amount > 0),
  tx_signature public.tx_signature not null unique,
  confirmed_at timestamptz not null default now()
);
create index receipts_challenge on public.receipts (challenge_id);
create index receipts_profile on public.receipts (profile_id);

-- ---------------------------------------------------------------- disputes

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships (id) on delete cascade,
  day smallint not null check (day between 0 and 59),
  opened_by uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (char_length(reason) between 10 and 1000),
  status public.dispute_status not null default 'open',
  resolution text check (char_length(resolution) <= 1000),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  check ((status = 'open') = (resolved_at is null)),
  check (status in ('open', 'withdrawn') or resolution is not null)
);
create unique index disputes_one_open_per_day on public.disputes (membership_id, day) where status = 'open';
create index disputes_membership on public.disputes (membership_id);
create index disputes_opened_by on public.disputes (opened_by);

-- ---------------------------------------------------------------- audit log (append-only)

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_kind public.actor_kind not null,
  actor_id uuid,                                   -- profile id when actor_kind = 'user'; no FK so entries outlive accounts
  action text not null check (action ~ '^[a-z][a-z0-9_.]{2,63}$'),
  entity_type text not null check (char_length(entity_type) between 1 and 40),
  entity_id text check (char_length(entity_id) <= 128),
  details jsonb not null default '{}',
  check (actor_kind <> 'user' or actor_id is not null)
);
create index audit_log_actor on public.audit_log (actor_id, at desc);
create index audit_log_entity on public.audit_log (entity_type, entity_id);

create or replace function private.audit_log_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log is append-only' using errcode = '42501';
end $$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function private.audit_log_append_only();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_log_append_only();

-- ---------------------------------------------------------------- voice clips (ElevenLabs coach)

create table public.voice_clips (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  challenge_id uuid references public.challenges (id) on delete cascade,
  kind public.voice_clip_kind not null,
  script text not null check (char_length(script) between 1 and 1500),
  voice_id text not null check (char_length(voice_id) between 1 and 64),
  storage_path text not null unique check (storage_path ~ '^[A-Za-z0-9/_.-]{1,255}$'),
  duration_ms integer check (duration_ms > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  check (expires_at is null or expires_at > created_at)
);
create index voice_clips_profile on public.voice_clips (profile_id, created_at desc);
create index voice_clips_challenge on public.voice_clips (challenge_id);

-- ---------------------------------------------------------------- badges (soulbound Token-2022)

create table public.badge_types (
  code text primary key check (code ~ '^[a-z][a-z0-9_]{2,39}$'),
  name text not null check (char_length(name) between 1 and 60),
  description text not null check (char_length(description) between 1 and 300),
  image_url text check (image_url ~ '^https://'),
  created_at timestamptz not null default now()
);

create table public.badges (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  badge_code text not null references public.badge_types (code) on delete restrict,
  challenge_id uuid references public.challenges (id) on delete set null,
  mint_address public.solana_address unique,       -- set once the soulbound token is minted
  mint_tx public.tx_signature unique,
  awarded_at timestamptz not null default now(),
  unique nulls not distinct (profile_id, badge_code, challenge_id),   -- awarded at most once
  check ((mint_address is null) = (mint_tx is null))
);
create index badges_code on public.badges (badge_code);
create index badges_challenge on public.badges (challenge_id);

-- ---------------------------------------------------------------- RLS on every new table
-- One SELECT policy per table (no overlapping permissive policies). No write policies: the server
-- (service role) writes after checking the chain or the providers.

alter table public.verification_runs enable row level security;
alter table public.evidence enable row level security;
alter table public.day_results enable row level security;
alter table public.receipts enable row level security;
alter table public.disputes enable row level security;
alter table public.audit_log enable row level security;
alter table public.voice_clips enable row level security;
alter table public.badge_types enable row level security;
alter table public.badges enable row level security;

create policy "runs of visible challenges" on public.verification_runs for select to anon, authenticated
  using (private.can_view_challenge(challenge_id));
create policy "evidence of visible members" on public.evidence for select to anon, authenticated
  using (private.can_view_membership(membership_id));
create policy "results of visible members" on public.day_results for select to anon, authenticated
  using (private.can_view_membership(membership_id));
create policy "disputes of visible members" on public.disputes for select to authenticated
  using (private.can_view_membership(membership_id));
create policy "own receipts" on public.receipts for select to authenticated
  using (profile_id = (select auth.uid()));
create policy "own audit entries" on public.audit_log for select to authenticated
  using (actor_id = (select auth.uid()));
create policy "own voice clips" on public.voice_clips for select to authenticated
  using (profile_id = (select auth.uid()));
create policy "badge types are public" on public.badge_types for select to anon, authenticated
  using (true);
create policy "badges are public" on public.badges for select to anon, authenticated
  using (true);

-- ---------------------------------------------------------------- leaderboard views
-- security_invoker: the caller's RLS applies, so private groups never leak through a view.

create view public.challenge_standings with (security_invoker = true) as
select
  m.id as membership_id,
  m.challenge_id,
  m.profile_id,
  p.public_id,
  p.display_name,
  m.status,
  count(d.id) filter (where d.result = 'verified') as verified_days,
  count(d.id) filter (where d.result = 'failed') as failed_days,
  count(d.id) filter (where d.result = 'indeterminate') as indeterminate_days,
  (select count(*) from public.shields s where s.membership_id = m.id) as shields_used
from public.memberships m
join public.profiles p on p.id = m.profile_id
left join public.day_results d on d.membership_id = m.id
group by m.id, p.public_id, p.display_name;

create view public.leaderboard with (security_invoker = true) as
select
  p.id as profile_id,
  p.public_id,
  p.display_name,
  count(m.id) as challenges_joined,
  count(m.id) filter (where m.status = 'survived') as challenges_survived,
  (
    select count(*) from public.day_results d
    join public.memberships m2 on m2.id = d.membership_id
    where m2.profile_id = p.id and d.result = 'verified'
  ) as verified_days,
  (select count(*) from public.badges b where b.profile_id = p.id) as badges
from public.profiles p
join public.memberships m on m.profile_id = p.id
group by p.id;

grant select on public.challenge_standings, public.leaderboard to anon, authenticated;
