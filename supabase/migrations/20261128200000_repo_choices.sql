-- Individual repository mode: each player picks their own GitHub repository for a challenge.
--
-- The challenge's repository *mode* is in its rules document (rules.github.repoMode), whose hash is
-- on-chain. A player's choice can't be (they choose after creation), so it is kept here as an
-- append-only history: each row applies from `effective_from`, and a day is checked against the
-- row in force when that day started. So a change never reaches back to a day already under way.
--
-- Written only by the web server (service role) after it has checked the repository on GitHub
-- (exists, public, owned by the player's linked GitHub account): never from the browser.

create table public.challenge_repo_choices (
  id bigint generated always as identity primary key,
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  repo_id bigint not null check (repo_id > 0),
  repo_owner_id bigint not null check (repo_owner_id > 0),
  full_name text not null check (full_name ~ '^[A-Za-z0-9-]{1,39}/[A-Za-z0-9_.-]{1,100}$'),
  effective_from timestamptz not null,
  selected_at timestamptz not null default now(),
  unique (challenge_id, profile_id, effective_from)
);
create index challenge_repo_choices_lookup on public.challenge_repo_choices (challenge_id, profile_id, effective_from desc);
create index challenge_repo_choices_profile on public.challenge_repo_choices (profile_id);

alter table public.challenge_repo_choices enable row level security;
revoke all on table public.challenge_repo_choices from anon, authenticated;
grant select on table public.challenge_repo_choices to authenticated;
-- A player sees their own choices (the challenge page shows "Your verification repository").
create policy "own repository choices" on public.challenge_repo_choices
  for select to authenticated using (profile_id = (select auth.uid()));

/**
 * Records a player's repository for an individual-mode challenge (service role only; the server
 * has already verified the repository on GitHub). Rules:
 *   - only for challenges whose rules say repoMode = individual, still open and not over;
 *   - a member, or someone who may still join (joining open; private groups: creator or invited);
 *   - locked once the player has a verified day (their streak is tied to that repository);
 *   - before the challenge starts the choice applies from day 1 (later picks replace it); during
 *     the challenge it applies from the next day, so the current and past days never change.
 */
create or replace function public.set_repo_choice(
  p_profile uuid, p_challenge uuid, p_repo_id bigint, p_owner_id bigint, p_full_name text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.challenges;
  m_id uuid;
  ends timestamptz;
  eff timestamptz;
  current_repo bigint;
  n integer;
begin
  select * into c from public.challenges where id = p_challenge;
  if c.id is null then raise exception 'Challenge not found.' using errcode = 'P0002'; end if;
  if coalesce(c.rules -> 'github' ->> 'repoMode', '') <> 'individual' then
    raise exception 'This challenge does not ask players to choose a repository.' using errcode = '22023';
  end if;
  if c.pool_state <> 'open' then raise exception 'This challenge is over.' using errcode = '22023'; end if;
  ends := c.start_at + make_interval(secs => c.day_length_secs * c.num_days);
  if now() >= ends then raise exception 'This challenge is over.' using errcode = '22023'; end if;

  select id into m_id from public.memberships where challenge_id = c.id and profile_id = p_profile;
  if m_id is null then
    if now() >= c.join_deadline_at then raise exception 'Joining has closed for this challenge.' using errcode = '22023'; end if;
    if c.visibility = 'private' and c.creator_id <> p_profile and not exists (
      select 1 from public.invitations i where i.challenge_id = c.id and i.invitee_id = p_profile and i.status in ('pending', 'accepted')
    ) then
      raise exception 'This is a private group. You need an invitation.' using errcode = '42501';
    end if;
  elsif exists (select 1 from public.day_results d where d.membership_id = m_id and d.result = 'verified') then
    raise exception 'Your repository is locked: you already have a verified day with it.' using errcode = '22023';
  end if;

  -- Before day 1: from day 1. During the challenge: from the start of the next day.
  if now() < c.start_at then
    eff := c.start_at;
  else
    eff := c.start_at + make_interval(secs => c.day_length_secs * (floor(extract(epoch from now() - c.start_at) / c.day_length_secs) + 1));
    if eff >= ends then raise exception 'There is no day left for a new repository to apply to.' using errcode = '22023'; end if;
  end if;

  select r.repo_id into current_repo from public.challenge_repo_choices r
   where r.challenge_id = c.id and r.profile_id = p_profile order by r.effective_from desc limit 1;
  if current_repo = p_repo_id then
    return jsonb_build_object('changed', false, 'effective_from', eff);
  end if;

  select count(*) into n from public.challenge_repo_choices where challenge_id = c.id and profile_id = p_profile;
  if n >= 20 then raise exception 'Too many repository changes for this challenge.' using errcode = '54000'; end if;

  insert into public.challenge_repo_choices (challenge_id, profile_id, repo_id, repo_owner_id, full_name, effective_from)
  values (c.id, p_profile, p_repo_id, p_owner_id, p_full_name, eff)
  on conflict (challenge_id, profile_id, effective_from)
  do update set repo_id = excluded.repo_id, repo_owner_id = excluded.repo_owner_id, full_name = excluded.full_name, selected_at = now();
  return jsonb_build_object('changed', true, 'effective_from', eff);
end $$;
revoke all on function public.set_repo_choice(uuid, uuid, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.set_repo_choice(uuid, uuid, bigint, bigint, text) to service_role;
