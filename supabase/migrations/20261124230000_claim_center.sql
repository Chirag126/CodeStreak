-- Phase 30 - Claim center: manual claims (fallback for the automatic payouts) and SOL unwrap.
--
-- Both go through relayer_requests, so every request is idempotent per user and rate-limited:
--   claim  : one row per player and challenge (fixed key), sent by the server; the relayer pays the
--            fee. The row's status is the lock that stops a double claim racing itself.
--   unwrap : the user signs CloseAccount of their own wrapped SOL account; the relayer pays the fee.
--            It acts on a wallet's token account, not on a challenge, so challenge_address is empty.
alter type public.relayer_kind add value if not exists 'unwrap';

alter table public.relayer_requests alter column challenge_address drop not null;
alter table public.relayer_requests add constraint relayer_requests_challenge_present
  check (challenge_address is not null or kind::text = 'unwrap');
