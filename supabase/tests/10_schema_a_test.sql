-- Phase 10 constraint tests. Run after the migrations (psql -v ON_ERROR_STOP=1).
-- Every rejected statement must fail; anything else aborts the run.
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

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c');

do $$
begin
  assert (select count(*) from public.profiles) = 3, 'a profile is created for each auth user';
  assert (select bool_and(public_id ~ '^CS-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$') from public.profiles), 'public IDs';
  assert (select count(distinct public_id) from public.profiles) = 3, 'public IDs are unique';
end $$;

insert into public.wallets (profile_id, address, kind, is_primary) values
  ('00000000-0000-0000-0000-00000000000a', '9piHsiBrsPrPJTYhiFk8PPKGhpndGZGgJmjBZtxJAHsD', 'phantom', true),
  ('00000000-0000-0000-0000-00000000000b', '4TYd5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JT', 'metamask', true);

insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs,
  num_days, join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs,
  verify_window_secs, dispute_window_secs, rules, rules_hash, onchain_address, onchain_challenge_id)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Public demo', 'public', 'usdc',
   '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 1000000, '2026-12-01T00:00:00Z', 300, 3, '2026-11-30T23:59:00Z',
   2, 50, 500000, 1, 120, 600, 900, '{"version":1}', repeat('ab', 32),
   'Fm4RMrKKkJsPP4vDeCPkYgE4jiGQjzujStgz17Yhrhv2', 18446744073709551615),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Friends only', 'private', 'sol',
   'So11111111111111111111111111111111111111112', 100000000, '2026-12-01T00:00:00Z', 86400, 7, '2026-11-30T00:00:00Z',
   2, 10, 0, 0, 0, 3600, 3600, '{"version":1}', repeat('cd', 32), null, null);

insert into public.memberships (id, challenge_id, profile_id, wallet_address, deposited, join_tx) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
   '9piHsiBrsPrPJTYhiFk8PPKGhpndGZGgJmjBZtxJAHsD', 1000000, repeat('5', 87)),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000b',
   '4TYd5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JT', 100000000, null);

insert into public.sponsorships (challenge_id, sponsor_wallet, amount, tx_signature) values
  ('10000000-0000-0000-0000-000000000001', '4TYd5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JT', 2500000, repeat('6', 87));
insert into public.shields (membership_id, day, price_paid, tx_signature) values
  ('20000000-0000-0000-0000-000000000001', 1, 500000, repeat('7', 87));
insert into public.linked_accounts (profile_id, provider, provider_user_id, provider_username) values
  ('00000000-0000-0000-0000-00000000000a', 'github', '123', 'chirag');
insert into public.invitations (challenge_id, invited_by, invitee_id) values
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
insert into public.invitations (challenge_id, invited_by, code_hash, max_uses, expires_at) values
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', repeat('ab', 32), 5, now() + interval '7 days');

do $$
begin
  assert (select is_demo from public.challenges where id = '10000000-0000-0000-0000-000000000001'), '300 s days are demo';
  assert not (select is_demo from public.challenges where id = '10000000-0000-0000-0000-000000000002'), '1 day is real time';
  assert (select onchain_challenge_id from public.challenges where id = '10000000-0000-0000-0000-000000000001')
    = 18446744073709551615, 'full u64 range is stored exactly';
  assert (select pg_typeof(joined_at)::text from public.memberships limit 1) = 'timestamp with time zone', 'timestamptz';
end $$;

-- ---------------------------------------------------------------- floats
select pg_temp.expect_fail('fractional buy-in', $q$
  update public.challenges set buy_in = 1.5 where id = '10000000-0000-0000-0000-000000000001' $q$);
select pg_temp.expect_fail('fractional sponsorship', $q$
  insert into public.sponsorships (challenge_id, sponsor_wallet, amount, tx_signature)
  values ('10000000-0000-0000-0000-000000000001', '4TYd5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JT', 0.5, repeat('8', 87)) $q$);
select pg_temp.expect_fail('fractional deposit', $q$
  update public.memberships set deposited = 10.25 where id = '20000000-0000-0000-0000-000000000001' $q$);
select pg_temp.expect_fail('fractional shield price', $q$
  update public.shields set price_paid = 2.000001 $q$);
select pg_temp.expect_fail('float text amount', $q$
  update public.challenges set total_stake = '1e-3' where id = '10000000-0000-0000-0000-000000000001' $q$);

-- ---------------------------------------------------------------- negatives, zero and overflow
select pg_temp.expect_fail('negative buy-in', $q$
  update public.challenges set buy_in = -1 where id = '10000000-0000-0000-0000-000000000001' $q$);
select pg_temp.expect_fail('zero buy-in', $q$
  update public.challenges set buy_in = 0 where id = '10000000-0000-0000-0000-000000000001' $q$);
select pg_temp.expect_fail('negative sponsorship', $q$
  update public.sponsorships set amount = -5 $q$);
select pg_temp.expect_fail('zero sponsorship', $q$
  update public.sponsorships set amount = 0 $q$);
select pg_temp.expect_fail('negative total', $q$
  update public.challenges set total_sponsor = -1 where id = '10000000-0000-0000-0000-000000000001' $q$);
select pg_temp.expect_fail('negative participant count', $q$
  update public.challenges set participant_count = -1 where id = '10000000-0000-0000-0000-000000000001' $q$);
select pg_temp.expect_fail('negative shield day', $q$ update public.shields set day = -1 $q$);
select pg_temp.expect_fail('shield day beyond 60 days', $q$ update public.shields set day = 60 $q$);
select pg_temp.expect_fail('u64 overflow', $q$
  update public.challenges set total_stake = 18446744073709551616 where id = '10000000-0000-0000-0000-000000000001' $q$);

-- ---------------------------------------------------------------- duplicates
select pg_temp.expect_fail('same user joins twice', $q$
  insert into public.memberships (challenge_id, profile_id, wallet_address, deposited)
  values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a',
          '4TYd5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JT', 1000000) $q$);
select pg_temp.expect_fail('same wallet joins twice', $q$
  insert into public.memberships (challenge_id, profile_id, wallet_address, deposited)
  values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c',
          '9piHsiBrsPrPJTYhiFk8PPKGhpndGZGgJmjBZtxJAHsD', 1000000) $q$);
select pg_temp.expect_fail('join tx counted twice', $q$
  update public.memberships set join_tx = repeat('5', 87) where id = '20000000-0000-0000-0000-000000000002' $q$);
select pg_temp.expect_fail('sponsorship tx counted twice', $q$
  insert into public.sponsorships (challenge_id, sponsor_wallet, amount, tx_signature)
  values ('10000000-0000-0000-0000-000000000001', '4TYd5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JT', 1, repeat('6', 87)) $q$);
select pg_temp.expect_fail('shield bought twice for a day', $q$
  insert into public.shields (membership_id, day, price_paid, tx_signature)
  values ('20000000-0000-0000-0000-000000000001', 1, 500000, repeat('9', 87)) $q$);
select pg_temp.expect_fail('wallet on two profiles', $q$
  insert into public.wallets (profile_id, address, kind)
  values ('00000000-0000-0000-0000-00000000000c', '9piHsiBrsPrPJTYhiFk8PPKGhpndGZGgJmjBZtxJAHsD', 'phantom') $q$);
select pg_temp.expect_fail('two primary wallets', $q$
  insert into public.wallets (profile_id, address, kind, is_primary)
  values ('00000000-0000-0000-0000-00000000000a', 'A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J', 'other', true) $q$);
select pg_temp.expect_fail('GitHub account on two profiles', $q$
  insert into public.linked_accounts (profile_id, provider, provider_user_id, provider_username)
  values ('00000000-0000-0000-0000-00000000000b', 'github', '123', 'someone') $q$);
select pg_temp.expect_fail('two GitHub accounts on one profile', $q$
  insert into public.linked_accounts (profile_id, provider, provider_user_id, provider_username)
  values ('00000000-0000-0000-0000-00000000000a', 'github', '456', 'alt') $q$);
select pg_temp.expect_fail('duplicate public ID', $q$
  update public.profiles set public_id = (select public_id from public.profiles where id = '00000000-0000-0000-0000-00000000000a')
  where id = '00000000-0000-0000-0000-00000000000b' $q$);
select pg_temp.expect_fail('duplicate on-chain challenge', $q$
  update public.challenges set onchain_address = 'Fm4RMrKKkJsPP4vDeCPkYgE4jiGQjzujStgz17Yhrhv2', onchain_challenge_id = 1
  where id = '10000000-0000-0000-0000-000000000002' $q$);
select pg_temp.expect_fail('two live invites to one person', $q$
  insert into public.invitations (challenge_id, invited_by, invitee_id)
  values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b') $q$);
update public.profiles set username = 'chirag' where id = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect_fail('duplicate username', $q$
  update public.profiles set username = 'chirag' where id = '00000000-0000-0000-0000-00000000000b' $q$);

-- ---------------------------------------------------------------- other invalid data
select pg_temp.expect_fail('bad wallet address', $q$
  update public.wallets set address = '0xdeadbeef' where kind = 'phantom' $q$);
select pg_temp.expect_fail('join deadline after start', $q$
  update public.challenges set join_deadline_at = start_at + interval '1 second' where id = '10000000-0000-0000-0000-000000000001' $q$);
select pg_temp.expect_fail('shield price without shields', $q$
  update public.challenges set max_shields = 0 where id = '10000000-0000-0000-0000-000000000001' $q$);
select pg_temp.expect_fail('invite with both person and link', $q$
  insert into public.invitations (challenge_id, invited_by, invitee_id, code_hash)
  values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a',
          '00000000-0000-0000-0000-00000000000c', repeat('cd', 32)) $q$);
select pg_temp.expect_fail('inviting yourself', $q$
  insert into public.invitations (challenge_id, invited_by, invitee_id)
  values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a') $q$);
select pg_temp.expect_fail('is_demo is derived, not writable', $q$
  update public.challenges set is_demo = false where id = '10000000-0000-0000-0000-000000000001' $q$);

-- ---------------------------------------------------------------- row level security
set role anon;
do $$
begin
  assert (select count(*) from public.challenges) = 1, 'anon sees only the public challenge';
  assert (select count(*) from public.memberships) = 1, 'anon sees members of public challenges only';
  assert (select count(*) from public.wallets) = 0, 'wallets are private';
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$
begin
  assert (select count(*) from public.challenges) = 2, 'an invited member sees the private challenge';
  assert (select count(*) from public.wallets) = 1, 'a user sees only their own wallet';
end $$;
select pg_temp.expect_fail('users cannot insert challenges directly', $q$
  insert into public.challenges (creator_id, title, token, mint, buy_in, start_at, day_length_secs, num_days,
    join_deadline_at, min_participants, max_participants, verify_window_secs, dispute_window_secs, rules, rules_hash)
  values ('00000000-0000-0000-0000-00000000000b', 'Sneaky', 'usdc', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    1, now() + interval '1 day', 86400, 1, now(), 2, 2, 3600, 3600, '{}', repeat('00', 32)) $q$);
select pg_temp.expect_fail('users cannot change their public ID', $q$
  update public.profiles set public_id = 'CS-AAAAAAAA' where id = '00000000-0000-0000-0000-00000000000b' $q$);
update public.profiles set display_name = 'Bob' where id = '00000000-0000-0000-0000-00000000000b';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$
begin
  assert (select count(*) from public.challenges) = 1, 'an outsider does not see the private challenge';
end $$;
update public.profiles set display_name = 'Hacked' where id = '00000000-0000-0000-0000-00000000000b';
reset role;
do $$
begin
  assert (select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000b') = 'Bob',
    'users can edit only their own profile';
end $$;

\echo 'schema_a: all constraint and RLS tests passed'
