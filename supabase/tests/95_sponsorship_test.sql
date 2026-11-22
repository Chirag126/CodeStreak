-- Phase 22 tests: sponsor links, receipts, leaderboard and visibility.
\set QUIET on
set client_min_messages = notice;

create function pg_temp.expect_fail(label text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'rejected  %  [%: %]', label, sqlstate, left(sqlerrm, 80);
    return;
  end;
  raise exception 'NOT REJECTED: %', label;
end $$;

-- 61 creator, 62 sponsor (outsider to the private group)
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000061'), ('00000000-0000-0000-0000-000000000062');
insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash)
values ('c2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000061', 'Sponsored group', 'private', 'usdc',
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 10000000, '2026-12-10T00:00:00Z', 86400, 3, '2026-12-10T00:00:00Z',
  2, 10, 0, 0, 0, 3600, 3600, '{}', repeat('55', 32));

update public.challenges set sponsor_link_hash = repeat('ef', 32), sponsor_link_created_at = now() where id = 'c2000000-0000-0000-0000-000000000001';
select pg_temp.expect_fail('raw sponsor token stored', $q$ update public.challenges set sponsor_link_hash = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde', sponsor_link_created_at = now() where id = 'c2000000-0000-0000-0000-000000000001' $q$);
select pg_temp.expect_fail('link hash without a time', $q$ update public.challenges set sponsor_link_created_at = null where id = 'c2000000-0000-0000-0000-000000000001' $q$);

select pg_temp.expect_fail('zero sponsorship', $q$
  insert into public.sponsorships (challenge_id, sponsor_wallet, amount, tx_signature) values ('c2000000-0000-0000-0000-000000000001', 'Ee5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 0, repeat('A', 87)) $q$);
select pg_temp.expect_fail('negative sponsorship', $q$
  insert into public.sponsorships (challenge_id, sponsor_wallet, amount, tx_signature) values ('c2000000-0000-0000-0000-000000000001', 'Ee5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', -1, repeat('A', 87)) $q$);
select pg_temp.expect_fail('amount above u64', $q$
  insert into public.sponsorships (challenge_id, sponsor_wallet, amount, tx_signature) values ('c2000000-0000-0000-0000-000000000001', 'Ee5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 18446744073709551616, repeat('A', 87)) $q$);

insert into public.sponsorships (challenge_id, sponsor_id, sponsor_wallet, amount, message, tx_signature, receipt_address) values
  ('c2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000062', 'Ee5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 5000000, 'Go!', repeat('B', 87), 'Ff5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa'),
  ('c2000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000062', 'Ee5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 2000000, null, repeat('C', 87), 'Ff5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa');
select pg_temp.expect_fail('same transaction counted twice', $q$
  insert into public.sponsorships (challenge_id, sponsor_wallet, amount, tx_signature) values ('c2000000-0000-0000-0000-000000000001', 'Ee5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 1, repeat('C', 87)) $q$);

do $$
declare r record;
begin
  select * into r from public.sponsor_leaderboard where challenge_id = 'c2000000-0000-0000-0000-000000000001';
  assert r.total = 7000000 and r.contributions = 2, format('leaderboard sums one wallet: %s', row(r.total, r.contributions));
  assert r.last_tx = repeat('C', 87) and r.last_message = 'Go!', 'latest tx and latest message';
  assert r.receipt_address = 'Ff5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'receipt address kept';
  assert (select version from public.challenge_activity where challenge_id = 'c2000000-0000-0000-0000-000000000001') >= 3, 'sponsorships bump the live board';
end $$;

-- A sponsor who is not in the private group can't read its sponsors (they see them only through the link page).
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000062', false);
do $$ begin
  assert (select count(*) from public.sponsor_leaderboard where challenge_id = 'c2000000-0000-0000-0000-000000000001') = 0, 'outsider sees no private sponsors';
  assert (select count(*) from public.challenges where sponsor_link_hash is not null) = 0, 'nor the link hash';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000061', false);
do $$ begin
  assert (select count(*) from public.sponsor_leaderboard where challenge_id = 'c2000000-0000-0000-0000-000000000001') = 1, 'the creator sees the sponsors';
end $$;
select pg_temp.expect_fail('a user records a sponsorship directly', $q$
  insert into public.sponsorships (challenge_id, sponsor_wallet, amount, tx_signature) values ('c2000000-0000-0000-0000-000000000001', 'Ee5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 1, repeat('D', 87)) $q$);
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo 'sponsorship: all tests passed'
