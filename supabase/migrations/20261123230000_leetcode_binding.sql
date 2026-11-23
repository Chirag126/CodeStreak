-- Phase 26 - LeetCode binding: a single-use code placed in the LeetCode profile proves ownership.

-- LeetCode handles are stored lower-cased (case-insensitive on LeetCode), so one handle can never
-- be linked twice under different casing (the existing unique (provider, provider_user_id) applies).
alter table public.linked_accounts
  add constraint linked_accounts_leetcode_handle check (provider <> 'leetcode' or provider_user_id ~ '^[a-z0-9_-]{1,40}$');

-- Codes are server-only (RLS on, no policies, no grants).
create table public.leetcode_binding_codes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  handle text not null check (handle ~ '^[A-Za-z0-9_-]{1,40}$'),
  code text not null unique check (code ~ '^CS-LC-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  cancelled_at timestamptz,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  check (used_at is null or cancelled_at is null)
);
create index leetcode_binding_codes_profile on public.leetcode_binding_codes (profile_id, created_at desc);
-- At most one live code per person.
create unique index leetcode_binding_codes_one_live on public.leetcode_binding_codes (profile_id) where used_at is null and cancelled_at is null;
alter table public.leetcode_binding_codes enable row level security;
revoke all on public.leetcode_binding_codes from anon, authenticated;
