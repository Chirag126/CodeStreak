-- Phase 23 - GitHub linking: numeric IDs, no swapping during open challenges, and a cooldown
-- before a released account can be linked to someone else. Enforced in the database so no code
-- path (or direct API call) can skip it.

-- GitHub user IDs are positive integers; usernames can be renamed and reused, so they are display only.
alter table public.linked_accounts
  add constraint linked_accounts_github_numeric_id
    check (provider <> 'github' or provider_user_id ~ '^[1-9][0-9]{0,19}$'),
  add column refreshed_at timestamptz not null default now();

-- Every unlink is remembered, so the same provider account can't hop between people.
create table public.linked_account_releases (
  id bigint generated always as identity primary key,
  provider public.provider not null,
  provider_user_id text not null,
  profile_id uuid not null,
  released_at timestamptz not null default now()
);
create index linked_account_releases_lookup on public.linked_account_releases (provider, provider_user_id, released_at desc);
alter table public.linked_account_releases enable row level security;
revoke all on public.linked_account_releases from anon, authenticated;

/** True while the profile is in a challenge that isn't settled or cancelled. */
create or replace function private.has_open_challenge(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m join public.challenges c on c.id = m.challenge_id
    where m.profile_id = target and m.status = 'active' and c.pool_state = 'open'
  );
$$;
revoke all on function private.has_open_challenge(uuid) from public;

create or replace function private.guard_linked_account() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    -- The whole profile is being deleted: nothing to protect.
    if not exists (select 1 from public.profiles where id = old.profile_id) then
      return old;
    end if;
    if private.has_open_challenge(old.profile_id) then
      raise exception 'linked account is locked while you are in an open challenge' using errcode = 'P0001', hint = 'locked';
    end if;
    insert into public.linked_account_releases (provider, provider_user_id, profile_id) values (old.provider, old.provider_user_id, old.profile_id);
    return old;
  end if;

  if tg_op = 'UPDATE' and (new.provider_user_id is distinct from old.provider_user_id or new.profile_id is distinct from old.profile_id or new.provider is distinct from old.provider) then
    if private.has_open_challenge(old.profile_id) then
      raise exception 'linked account is locked while you are in an open challenge' using errcode = 'P0001', hint = 'locked';
    end if;
    insert into public.linked_account_releases (provider, provider_user_id, profile_id) values (old.provider, old.provider_user_id, old.profile_id);
  end if;

  if tg_op = 'INSERT' or new.provider_user_id is distinct from old.provider_user_id or new.profile_id is distinct from old.profile_id then
    -- Released by someone else in the last 30 days: not yet.
    if exists (
      select 1 from public.linked_account_releases r
      where r.provider = new.provider and r.provider_user_id = new.provider_user_id
        and r.profile_id <> new.profile_id and r.released_at > now() - interval '30 days'
    ) then
      raise exception 'this account was linked to another CodeStreak user in the last 30 days' using errcode = 'P0001', hint = 'cooldown';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_linked_account() from public;

create trigger linked_accounts_guard before insert or update or delete on public.linked_accounts
  for each row execute function private.guard_linked_account();
