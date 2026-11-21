-- Phase 10 - Schema A: profiles, wallets, linked accounts, challenges, memberships, invitations,
-- sponsorships, shields.
--
-- Conventions
--   * Token amounts are integer base units (USDC: 6 decimals, SOL: 9) in the `u64` domain: numeric
--     with no fractional part, never negative, at most 2^64 - 1. Fractions are REJECTED (bigint
--     would silently round 1.5 to 2).
--   * Every timestamp is timestamptz (stored as UTC).
--   * The chain is the source of truth for money; these tables mirror it for the app. Writes happen
--     on the server (service role). RLS lets browsers read only what they may see.

-- ---------------------------------------------------------------- types

create domain public.u64 as numeric
  check (value >= 0 and value = trunc(value) and value <= 18446744073709551615);

create domain public.solana_address as text
  check (value ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$');

create domain public.tx_signature as text
  check (value ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$');

create type public.wallet_kind as enum ('phantom', 'metamask', 'other');
create type public.provider as enum ('github', 'leetcode');
create type public.challenge_visibility as enum ('public', 'private');
create type public.stake_token as enum ('usdc', 'sol');
create type public.pool_state as enum ('open', 'cancelled', 'settled');
create type public.membership_status as enum ('active', 'survived', 'failed', 'voided');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');

-- ---------------------------------------------------------------- helpers

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Personal public ID used to invite friends: "CS-" + 8 chars from an alphabet without 0/O/1/I/L.
create or replace function public.generate_public_id() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  result text := 'CS-';
begin
  for i in 1..8 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end $$;

-- ---------------------------------------------------------------- profiles

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  public_id text not null unique default public.generate_public_id()
    check (public_id ~ '^CS-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$'),
  username text unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text check (char_length(display_name) between 1 and 50),
  avatar_url text check (avatar_url ~ '^https://'),
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Every new auth user gets a profile (and a public ID) automatically.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- wallets

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  address public.solana_address not null unique,  -- one wallet belongs to one profile
  kind public.wallet_kind not null,
  is_primary boolean not null default false,
  verified_at timestamptz,                          -- set after a signed-message ownership check
  created_at timestamptz not null default now()
);
create unique index wallets_one_primary on public.wallets (profile_id) where is_primary;
create index wallets_profile on public.wallets (profile_id);

-- ---------------------------------------------------------------- linked accounts

create table public.linked_accounts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  provider public.provider not null,
  provider_user_id text not null check (char_length(provider_user_id) between 1 and 64),
  provider_username text not null check (char_length(provider_username) between 1 and 64),
  linked_at timestamptz not null default now(),
  unique (profile_id, provider),          -- one GitHub and one LeetCode per profile
  unique (provider, provider_user_id)     -- a provider account can't be shared between profiles
);

-- ---------------------------------------------------------------- challenges

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete restrict,
  title text not null check (char_length(title) between 3 and 80),
  description text check (char_length(description) <= 1000),
  visibility public.challenge_visibility not null default 'public',
  token public.stake_token not null,
  -- On-chain mirror (set once the pool is created on devnet).
  onchain_address public.solana_address unique,
  onchain_challenge_id public.u64,
  mint public.solana_address not null,
  vault public.solana_address unique,
  create_tx public.tx_signature unique,
  -- Rules (identical to the program's parameters).
  buy_in public.u64 not null check (buy_in > 0),
  start_at timestamptz not null,
  day_length_secs integer not null check (day_length_secs between 60 and 86400),
  num_days smallint not null check (num_days between 1 and 60),
  join_deadline_at timestamptz not null,
  min_participants smallint not null check (min_participants >= 2),
  max_participants smallint not null check (max_participants <= 1000),
  shield_price public.u64 not null default 0,
  max_shields smallint not null default 0 check (max_shields between 0 and 3),
  shield_grace_secs integer not null default 0 check (shield_grace_secs >= 0),
  verify_window_secs integer not null check (verify_window_secs between 60 and 604800),
  dispute_window_secs integer not null check (dispute_window_secs between 60 and 604800),
  rules jsonb not null,
  rules_hash text not null check (rules_hash ~ '^[0-9a-f]{64}$'),
  is_demo boolean generated always as (day_length_secs < 86400) stored,
  -- Mirrored state and totals.
  pool_state public.pool_state not null default 'open',
  participant_count smallint not null default 0 check (participant_count >= 0),
  total_stake public.u64 not null default 0,
  total_sponsor public.u64 not null default 0,
  total_shield public.u64 not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (join_deadline_at <= start_at),
  check (min_participants <= max_participants),
  check (participant_count <= max_participants),
  check ((max_shields = 0) = (shield_price = 0)),
  check (max_shields > 0 or shield_grace_secs = 0),
  check (shield_grace_secs <= day_length_secs),
  check ((onchain_address is null) = (onchain_challenge_id is null)),
  unique (creator_id, onchain_challenge_id)
);
create trigger challenges_updated_at before update on public.challenges
  for each row execute function public.set_updated_at();
create index challenges_public_start on public.challenges (start_at) where visibility = 'public';

-- ---------------------------------------------------------------- memberships

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  wallet_address public.solana_address not null,
  participant_address public.solana_address unique,   -- the Participant PDA
  deposited public.u64 not null check (deposited > 0),
  status public.membership_status not null default 'active',
  join_tx public.tx_signature unique,
  joined_at timestamptz not null default now(),
  finalized_at timestamptz,
  claimed_at timestamptz,
  payout public.u64,
  unique (challenge_id, profile_id),
  unique (challenge_id, wallet_address)
);
create index memberships_profile on public.memberships (profile_id);

-- ---------------------------------------------------------------- invitations (private groups)

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  invited_by uuid not null references public.profiles (id) on delete cascade,
  invitee_id uuid references public.profiles (id) on delete cascade,    -- invite by public ID
  code text unique check (code ~ '^[A-Za-z0-9_-]{16,64}$'),           -- or by shareable link
  status public.invitation_status not null default 'pending',
  max_uses smallint check (max_uses > 0),
  use_count smallint not null default 0 check (use_count >= 0),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check ((invitee_id is null) <> (code is null)),     -- exactly one of: a person, or a link
  check (invitee_id is null or max_uses is null),
  check (max_uses is null or use_count <= max_uses),
  check (invitee_id is distinct from invited_by)
);
create unique index invitations_one_pending_per_invitee
  on public.invitations (challenge_id, invitee_id) where status = 'pending' and invitee_id is not null;
create index invitations_invitee on public.invitations (invitee_id) where invitee_id is not null;

-- ---------------------------------------------------------------- sponsorships

create table public.sponsorships (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  sponsor_id uuid references public.profiles (id) on delete set null,   -- null: anonymous wallet
  sponsor_wallet public.solana_address not null,
  amount public.u64 not null check (amount > 0),
  message text check (char_length(message) <= 140),
  tx_signature public.tx_signature not null unique,                    -- each deposit counted once
  created_at timestamptz not null default now()
);
create index sponsorships_challenge on public.sponsorships (challenge_id);

-- ---------------------------------------------------------------- shields

create table public.shields (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships (id) on delete cascade,
  day smallint not null check (day between 0 and 59),
  price_paid public.u64 not null check (price_paid > 0),
  tx_signature public.tx_signature not null unique,
  activated_at timestamptz not null default now(),
  unique (membership_id, day)
);

-- ---------------------------------------------------------------- row level security
-- Browsers use the anon/authenticated roles; the server uses the service role (bypasses RLS).
-- No insert/update/delete policies exist except editing your own profile: all other writes are
-- made by the server after checking the chain.

alter table public.profiles enable row level security;
alter table public.wallets enable row level security;
alter table public.linked_accounts enable row level security;
alter table public.challenges enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.sponsorships enable row level security;
alter table public.shields enable row level security;

-- Whether the current user may see a challenge: public ones, or private ones they created,
-- joined, or were invited to. SECURITY DEFINER so it can look across tables without RLS loops.
create or replace function public.can_view_challenge(target uuid) returns boolean
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

create policy "profiles are readable" on public.profiles for select to anon, authenticated using (true);
create policy "users update their own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "own wallets" on public.wallets for select to authenticated using (profile_id = (select auth.uid()));
create policy "own linked accounts" on public.linked_accounts for select to authenticated using (profile_id = (select auth.uid()));

create policy "visible challenges" on public.challenges for select to anon, authenticated
  using (public.can_view_challenge(id));
create policy "members of visible challenges" on public.memberships for select to anon, authenticated
  using (public.can_view_challenge(challenge_id));
create policy "sponsors of visible challenges" on public.sponsorships for select to anon, authenticated
  using (public.can_view_challenge(challenge_id));
create policy "shields of visible challenges" on public.shields for select to anon, authenticated
  using (exists (select 1 from public.memberships m where m.id = membership_id and public.can_view_challenge(m.challenge_id)));
create policy "own invitations" on public.invitations for select to authenticated
  using (invitee_id = (select auth.uid()) or invited_by = (select auth.uid()));

-- Profiles: users may change only presentation fields (never id or public_id).
revoke update on public.profiles from anon, authenticated;
grant update (username, display_name, avatar_url, timezone) on public.profiles to authenticated;

-- Functions are not callable from the API except the visibility helper used by policies.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.generate_public_id() from public, anon, authenticated;
