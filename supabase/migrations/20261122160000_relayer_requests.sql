-- Phase 15 - relayer requests: one row per sponsored transaction, keyed by the client's idempotency
-- key. Backs idempotency (retries return the same transaction or result), per-user rate limits and
-- the "exactly the transaction we built" check (message hash). Written by the server only.

create type public.relayer_kind as enum ('join', 'sponsor', 'shield', 'claim');
create type public.relayer_status as enum ('prepared', 'submitting', 'confirmed', 'failed');

create table public.relayer_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  idempotency_key uuid not null,
  kind public.relayer_kind not null,
  challenge_address public.solana_address not null,
  wallet public.solana_address not null,
  message_hash text not null check (message_hash ~ '^[0-9a-f]{64}$'),   -- SHA-256 of the exact message the relayer signed
  prepared_tx text not null check (char_length(prepared_tx) <= 2000),   -- base64, relayer-signed, awaiting the user's signature
  last_valid_block_height bigint not null check (last_valid_block_height > 0),
  status public.relayer_status not null default 'prepared',
  signature public.tx_signature unique,
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, idempotency_key),
  check ((status = 'confirmed') = (signature is not null))
);
create index relayer_requests_profile_recent on public.relayer_requests (profile_id, created_at desc);
create trigger relayer_requests_updated_at before update on public.relayer_requests
  for each row execute function public.set_updated_at();

alter table public.relayer_requests enable row level security;
create policy "own relayer requests" on public.relayer_requests for select to authenticated
  using (profile_id = (select auth.uid()));
