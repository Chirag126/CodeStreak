-- Phase 18 tests: challenge_overview stats and RLS through the view.
\set QUIET on
set client_min_messages = notice;

insert into auth.users (id) values ('00000000-0000-0000-0000-000000000031'), ('00000000-0000-0000-0000-000000000032'),
  ('00000000-0000-0000-0000-000000000033'), ('00000000-0000-0000-0000-000000000034');

insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash, participant_count, total_stake, total_sponsor, total_shield)
values
  ('f0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000031', 'Overview public', 'public', 'usdc',
   '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 10000000, '2026-12-01T00:00:00Z', 86400, 3, '2026-12-01T00:00:00Z',
   2, 10, 2000000, 1, 3600, 3600, 3600, '{}', repeat('11', 32), 3, 30000000, 5000000, 2000000),
  ('f0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000031', 'Overview private', 'private', 'usdc',
   '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 10000000, '2026-12-01T00:00:00Z', 300, 3, '2026-11-30T23:59:00Z',
   2, 10, 0, 0, 0, 600, 900, '{}', repeat('22', 32), 0, 0, 0, 0);

insert into public.memberships (id, challenge_id, profile_id, wallet_address, deposited) values
  ('f1000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000031', 'Aa5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000),
  ('f1000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000032', 'Bb5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000),
  ('f1000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000033', 'Cc5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000);
-- member 2 failed day 0 (out); member 3 failed day 0 but shielded it (still in)
insert into public.day_results (membership_id, day, result, evidence_hash) values
  ('f1000000-0000-0000-0000-000000000002', 0, 'failed', repeat('0', 64)),
  ('f1000000-0000-0000-0000-000000000003', 0, 'failed', repeat('0', 64));
insert into public.shields (membership_id, day, price_paid, tx_signature) values ('f1000000-0000-0000-0000-000000000003', 0, 2000000, repeat('Z', 87));

do $$
declare o record;
begin
  select * into o from public.challenge_overview where id = 'f0000000-0000-0000-0000-000000000001';
  assert o.pool_total = 37000000, 'pool = stakes + sponsors + Shields';
  assert o.end_at = '2026-12-04T00:00:00Z'::timestamptz, 'end = start + days';
  assert (o.members, o.still_in, o.survived, o.finalized) = (3, 2, 0, 0), format('stats %s', row(o.members, o.still_in, o.survived, o.finalized));
end $$;

-- RLS through the view: a stranger sees the public challenge only.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000034', false);
do $$
begin
  assert (select count(*) from public.challenge_overview where id in ('f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002')) = 1,
    'the private challenge is hidden from a non-member';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000031', false);
do $$
begin
  assert (select count(*) from public.challenge_overview where id in ('f0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000002')) = 2,
    'the creator sees both';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo 'overview: all tests passed'
