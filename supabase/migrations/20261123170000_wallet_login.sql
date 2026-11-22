-- Wallet login: single-use, short-lived, browser-bound sign-in challenges. Server-only
-- (RLS on, no policies, no grants): users can neither read nor forge them.
create table public.wallet_login_challenges (
  id uuid primary key default gen_random_uuid(),
  address public.solana_address not null,
  nonce text not null unique check (nonce ~ '^[0-9a-f]{32}$'),
  message text not null check (char_length(message) <= 1000),
  -- SHA-256 of a random httpOnly cookie in the browser that asked for the challenge
  browser_hash text not null check (browser_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  check (expires_at > issued_at and expires_at <= issued_at + interval '10 minutes'),
  check (used_at is null or used_at >= issued_at)
);
create index wallet_login_challenges_address on public.wallet_login_challenges (address, issued_at desc);
create index wallet_login_challenges_expires on public.wallet_login_challenges (expires_at);
alter table public.wallet_login_challenges enable row level security;
revoke all on public.wallet_login_challenges from anon, authenticated;

-- Rate-limit counters for wallet sign-in (per wallet address, hashed like emails).
alter type public.sign_in_attempt_kind add value if not exists 'wallet_challenge';
alter type public.sign_in_attempt_kind add value if not exists 'wallet_failure';
