-- Phase 17 - sponsored challenge creation. A 'create' relayer request carries the app-only details
-- (title, description, rules document) in `payload`; they are written to the challenges row once
-- the on-chain creation confirms.

alter type public.relayer_kind add value if not exists 'create';

alter table public.relayer_requests
  add column payload jsonb not null default '{}'::jsonb
  check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 8192);
