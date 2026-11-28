-- Phase 43: the worker's address lookup table (accounts every challenge transaction repeats).
-- The table lives on-chain; this row only remembers its address so the worker reuses it. One row
-- per authority (the verifier key). Service role only, like the other worker tables.
create table public.chain_lookup_tables (
  authority text primary key check (authority ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  address text not null unique check (address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  addresses integer not null default 0 check (addresses between 0 and 256),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.chain_lookup_tables enable row level security;
revoke all on table public.chain_lookup_tables from anon, authenticated;
create policy "no direct access" on public.chain_lookup_tables as restrictive for all to anon, authenticated using (false) with check (false);

comment on table public.chain_lookup_tables is 'Phase 43: address of the worker''s on-chain address lookup table, per authority. Written by the worker (service role).';
