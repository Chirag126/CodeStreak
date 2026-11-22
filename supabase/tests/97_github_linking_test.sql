-- Phase 23 tests: GitHub linking rules.
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

-- 71 Ana, 72 Bo, 73 Cy
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000071'), ('00000000-0000-0000-0000-000000000072'), ('00000000-0000-0000-0000-000000000073');

insert into public.linked_accounts (profile_id, provider, provider_user_id, provider_username) values ('00000000-0000-0000-0000-000000000071', 'github', '583231', 'octo-ana');

select pg_temp.expect_fail('GitHub username stored as the ID', $q$
  insert into public.linked_accounts (profile_id, provider, provider_user_id, provider_username) values ('00000000-0000-0000-0000-000000000072', 'github', 'octo-bo', 'octo-bo') $q$);
select pg_temp.expect_fail('GitHub ID with a leading zero', $q$
  insert into public.linked_accounts (profile_id, provider, provider_user_id, provider_username) values ('00000000-0000-0000-0000-000000000072', 'github', '0583231', 'x') $q$);
select pg_temp.expect_fail('same GitHub ID on a second account', $q$
  insert into public.linked_accounts (profile_id, provider, provider_user_id, provider_username) values ('00000000-0000-0000-0000-000000000072', 'github', '583231', 'octo-ana') $q$);
select pg_temp.expect_fail('second GitHub on one account', $q$
  insert into public.linked_accounts (profile_id, provider, provider_user_id, provider_username) values ('00000000-0000-0000-0000-000000000071', 'github', '99', 'other') $q$);

-- Users can't write the table directly.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000072', false);
select pg_temp.expect_fail('a user inserts a linked account', $q$
  insert into public.linked_accounts (profile_id, provider, provider_user_id, provider_username) values ('00000000-0000-0000-0000-000000000072', 'github', '777', 'me') $q$);
do $$ begin
  assert (select count(*) from public.linked_accounts) = 0, 'a user sees only their own linked accounts';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- Locked while Ana is in an open challenge.
insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash)
values ('d3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000073', 'Lock test', 'public', 'usdc',
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 10000000, '2026-12-10T00:00:00Z', 86400, 3, '2026-12-10T00:00:00Z',
  2, 10, 0, 0, 0, 3600, 3600, '{}', repeat('66', 32));
insert into public.memberships (challenge_id, profile_id, wallet_address, deposited) values
  ('d3000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000071', 'Hh5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000);

select pg_temp.expect_fail('unlink during an open challenge', $q$ delete from public.linked_accounts where profile_id = '00000000-0000-0000-0000-000000000071' $q$);
select pg_temp.expect_fail('swap GitHub during an open challenge', $q$ update public.linked_accounts set provider_user_id = '4242' where profile_id = '00000000-0000-0000-0000-000000000071' $q$);
update public.linked_accounts set provider_username = 'octo-ana-renamed' where profile_id = '00000000-0000-0000-0000-000000000071';  -- a rename is fine

-- Challenge settles: unlocked. Ana unlinks; Bo can't take the same GitHub for 30 days; Ana can.
update public.challenges set pool_state = 'settled' where id = 'd3000000-0000-0000-0000-000000000001';
delete from public.linked_accounts where profile_id = '00000000-0000-0000-0000-000000000071';
select pg_temp.expect_fail('another account links a just-released GitHub', $q$
  insert into public.linked_accounts (profile_id, provider, provider_user_id, provider_username) values ('00000000-0000-0000-0000-000000000072', 'github', '583231', 'octo-ana') $q$);
insert into public.linked_accounts (profile_id, provider, provider_user_id, provider_username) values ('00000000-0000-0000-0000-000000000071', 'github', '583231', 'octo-ana');
update public.linked_account_releases set released_at = now() - interval '31 days';
delete from public.linked_accounts where profile_id = '00000000-0000-0000-0000-000000000071';
update public.linked_account_releases set released_at = now() - interval '31 days';
insert into public.linked_accounts (profile_id, provider, provider_user_id, provider_username) values ('00000000-0000-0000-0000-000000000072', 'github', '583231', 'octo-ana');

-- Deleting a whole profile still works (cascade).
delete from public.memberships where profile_id = '00000000-0000-0000-0000-000000000072';
delete from public.profiles where id = '00000000-0000-0000-0000-000000000072';
do $$ begin
  assert (select count(*) from public.linked_accounts where profile_id = '00000000-0000-0000-0000-000000000072') = 0, 'cascade removed the link';
end $$;

\echo 'github linking: all tests passed'
