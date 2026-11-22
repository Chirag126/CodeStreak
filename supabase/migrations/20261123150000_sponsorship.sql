-- Phase 22 - sponsorship: private sponsor links, on-chain receipt addresses, sponsor leaderboard.

-- One sponsor link per challenge: only its SHA-256 is stored (the token is shown once). Holders
-- may sponsor a private group without seeing its members; regenerating replaces the old link.
alter table public.challenges
  add column sponsor_link_hash text unique check (sponsor_link_hash ~ '^[0-9a-f]{64}$'),
  add column sponsor_link_created_at timestamptz,
  add constraint challenges_sponsor_link_time check ((sponsor_link_hash is null) = (sponsor_link_created_at is null));

-- The SponsorReceipt PDA that accumulates this wallet's total on-chain.
alter table public.sponsorships add column receipt_address public.solana_address;
create index sponsorships_challenge_wallet on public.sponsorships (challenge_id, sponsor_wallet);

-- Sponsor leaderboard: one row per sponsoring wallet per challenge (RLS of sponsorships applies).
create view public.sponsor_leaderboard with (security_invoker = true) as
select
  s.challenge_id,
  s.sponsor_wallet,
  max(s.receipt_address) as receipt_address,
  (array_agg(s.sponsor_id order by s.created_at desc))[1] as sponsor_id,
  p.public_id,
  p.display_name,
  p.username,
  sum(s.amount)::numeric as total,
  count(*) as contributions,
  max(s.created_at) as last_at,
  (array_agg(s.tx_signature order by s.created_at desc))[1] as last_tx,
  (array_agg(s.message order by s.created_at desc) filter (where s.message is not null))[1] as last_message
from public.sponsorships s
left join public.profiles p on p.id = s.sponsor_id
group by s.challenge_id, s.sponsor_wallet, p.public_id, p.display_name, p.username;
grant select on public.sponsor_leaderboard to anon, authenticated;

-- New sponsorships update open group boards live.
create trigger sponsorships_activity after insert or delete on public.sponsorships
  for each row execute function private.on_challenge_child_change();
