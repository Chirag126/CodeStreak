-- Day checks in the app: a per-member, per-day summary of the latest check, plus visibility that
-- the database enforces (not just the app):
--   - a member who turned off "share check details" is visible only to themselves;
--   - a creator who limited the board to players hides members' checks from everyone else.

create or replace function private.can_view_member_checks(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.memberships m
    join public.challenges c on c.id = m.challenge_id
    where m.id = target
      and private.can_view_challenge(c.id)
      and (
        m.profile_id = auth.uid()
        or (
          m.share_checks
          and (
            c.board_visibility = 'viewers'
            or c.creator_id = auth.uid()
            or exists (select 1 from public.memberships p where p.challenge_id = c.id and p.profile_id = auth.uid())
          )
        )
      )
  );
$$;
revoke all on function private.can_view_member_checks(uuid) from public;
grant execute on function private.can_view_member_checks(uuid) to anon, authenticated, service_role;

-- Evidence (one row per commit considered) now follows both settings.
drop policy "evidence of visible members" on public.evidence;
create policy "evidence of visible members" on public.evidence for select to anon, authenticated
  using (private.can_view_member_checks(membership_id));

-- The latest check of a member's day: a preview while the day runs; the final result lives in day_results.
create table public.member_day_checks (
  membership_id uuid not null references public.memberships (id) on delete cascade,
  day smallint not null check (day between 0 and 59),
  provider public.provider not null default 'github',
  run_id uuid references public.verification_runs (id) on delete set null,
  lines integer not null check (lines >= 0),
  goal integer not null check (goal > 0),
  breakdown jsonb not null default '{}',
  -- met: goal reached; not_met: below the goal with complete data; unknown: data incomplete
  outcome text not null check (outcome in ('met', 'not_met', 'unknown')),
  complete boolean not null,
  pushes integer not null default 0 check (pushes >= 0),
  commits integer not null default 0 check (commits >= 0),
  hints jsonb not null default '[]' check (jsonb_typeof(hints) = 'array' and jsonb_array_length(hints) <= 12),
  notes jsonb not null default '[]' check (jsonb_typeof(notes) = 'array' and jsonb_array_length(notes) <= 12),
  checked_by uuid references public.profiles (id) on delete set null,
  checked_at timestamptz not null default now(),
  primary key (membership_id, day, provider)
);
alter table public.member_day_checks enable row level security;
create policy "checks of visible members" on public.member_day_checks for select to anon, authenticated
  using (private.can_view_member_checks(membership_id));
revoke insert, update, delete, truncate on public.member_day_checks from anon, authenticated;
grant select on public.member_day_checks to anon, authenticated;

-- A new check updates open group boards live.
create trigger member_day_checks_activity after insert or update or delete on public.member_day_checks
  for each row execute function private.on_membership_child_change();
