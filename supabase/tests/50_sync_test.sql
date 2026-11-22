-- Phase 16 tests: chain sync can mirror challenges created outside the app, idempotently.
\set QUIET on
set client_min_messages = notice;

insert into public.challenges (creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash, onchain_address, onchain_challenge_id, vault)
values (null, 'Demo challenge Abcd', 'public', 'usdc', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 1000000,
  '2026-12-02T00:00:00Z', 300, 3, '2026-12-01T23:59:00Z', 2, 50, 500000, 1, 120, 600, 900, '{"source":"chain"}', repeat('ab', 32),
  'HrRqkvSRZ8nvU9wGgUX3dkVoHVnTUbmDB1M3Ch6ckdJ2', 1795282290646, '7dLZ8VxCH3V4rkoK4rWMZyZSaH6MbQ4JbS8kqv4wE9Mq');

-- Sync runs again after every transaction: the upsert updates the same row.
insert into public.challenges (creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash, onchain_address, onchain_challenge_id, vault, participant_count, total_stake)
values (null, 'Demo challenge Abcd', 'public', 'usdc', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 1000000,
  '2026-12-02T00:00:00Z', 300, 3, '2026-12-01T23:59:00Z', 2, 50, 500000, 1, 120, 600, 900, '{"source":"chain"}', repeat('ab', 32),
  'HrRqkvSRZ8nvU9wGgUX3dkVoHVnTUbmDB1M3Ch6ckdJ2', 1795282290646, '7dLZ8VxCH3V4rkoK4rWMZyZSaH6MbQ4JbS8kqv4wE9Mq', 1, 1000000)
on conflict (onchain_address) do update set participant_count = excluded.participant_count, total_stake = excluded.total_stake;

do $$
begin
  assert (select count(*) from public.challenges where onchain_address = 'HrRqkvSRZ8nvU9wGgUX3dkVoHVnTUbmDB1M3Ch6ckdJ2') = 1, 'one row per on-chain challenge';
  assert (select participant_count from public.challenges where onchain_address = 'HrRqkvSRZ8nvU9wGgUX3dkVoHVnTUbmDB1M3Ch6ckdJ2') = 1, 'mirror updated';
  assert (select creator_id is null from public.challenges where onchain_address = 'HrRqkvSRZ8nvU9wGgUX3dkVoHVnTUbmDB1M3Ch6ckdJ2'), 'external creator allowed';
end $$;

\echo 'sync: all tests passed'
