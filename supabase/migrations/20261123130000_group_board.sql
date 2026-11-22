-- Phase 21 - group dashboard: visibility settings and a realtime "something changed" signal.

-- Owner: who sees the member board. Member: whether their check details are shown to others.
create type public.board_visibility as enum ('viewers', 'participants');
alter table public.challenges add column board_visibility public.board_visibility not null default 'viewers';
alter table public.memberships add column share_checks boolean not null default true;

-- One row per challenge; its version goes up whenever anything on the board changes. Browsers
-- subscribe to it through Realtime (which applies the same RLS as reads), then re-fetch the board,
-- so only "changed" travels over the socket, never member data.
create table public.challenge_activity (
  challenge_id uuid primary key references public.challenges (id) on delete cascade,
  version bigint not null default 1 check (version > 0),
  changed_at timestamptz not null default now()
);
alter table public.challenge_activity enable row level security;
create policy "visible challenges" on public.challenge_activity for select to anon, authenticated
  using (private.can_view_challenge(challenge_id));
revoke insert, update, delete, truncate on public.challenge_activity from anon, authenticated;
grant select on public.challenge_activity to anon, authenticated;

create or replace function private.bump_challenge_activity(target uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.challenge_activity as a (challenge_id)
  select target where exists (select 1 from public.challenges c where c.id = target)
  on conflict (challenge_id) do update set version = a.version + 1, changed_at = now();
$$;
revoke all on function private.bump_challenge_activity(uuid) from public;

create or replace function private.on_challenge_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bump_challenge_activity(new.id);
  return null;
end $$;

create or replace function private.on_challenge_child_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bump_challenge_activity(coalesce(new.challenge_id, old.challenge_id));
  return null;
end $$;

create or replace function private.on_membership_child_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bump_challenge_activity(m.challenge_id)
  from public.memberships m where m.id = coalesce(new.membership_id, old.membership_id);
  return null;
end $$;
revoke all on function private.on_challenge_change(), private.on_challenge_child_change(), private.on_membership_child_change() from public;

create trigger challenges_activity after insert or update on public.challenges
  for each row execute function private.on_challenge_change();
create trigger memberships_activity after insert or update or delete on public.memberships
  for each row execute function private.on_challenge_child_change();
create trigger verification_runs_activity after insert or update on public.verification_runs
  for each row execute function private.on_challenge_child_change();
create trigger day_results_activity after insert or update or delete on public.day_results
  for each row execute function private.on_membership_child_change();
create trigger shields_activity after insert or delete on public.shields
  for each row execute function private.on_membership_child_change();

insert into public.challenge_activity (challenge_id) select id from public.challenges on conflict do nothing;

alter publication supabase_realtime add table public.challenge_activity;
