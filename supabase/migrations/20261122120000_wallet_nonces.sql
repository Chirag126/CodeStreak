-- Phase 13 - wallet binding challenges. Each row is a single-use, short-lived nonce that a wallet
-- must sign to prove ownership. Written only by the server (service role); users may read their own.

create table public.wallet_nonces (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  address public.solana_address not null,          -- 0x / non-Solana addresses are rejected by the domain
  nonce text not null unique check (nonce ~ '^[0-9a-f]{32}$'),
  message text not null check (char_length(message) between 1 and 1000),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > issued_at and expires_at <= issued_at + interval '15 minutes'),
  check (used_at is null or used_at >= issued_at)
);
create index wallet_nonces_profile_address on public.wallet_nonces (profile_id, address, issued_at desc);

alter table public.wallet_nonces enable row level security;
create policy "own wallet nonces" on public.wallet_nonces for select to authenticated
  using (profile_id = (select auth.uid()));
