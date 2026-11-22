-- Phase 21 tests: board settings and the realtime activity signal.
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

create function pg_temp.version(c uuid) returns bigint language sql as $$
  select version from public.challenge_activity where challenge_id = c
$$;

-- 51 creator, 52 member, 53 outsider
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000051'), ('00000000-0000-0000-0000-000000000052'), ('00000000-0000-0000-0000-000000000053');
insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash)
values ('b9000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000051', 'Board group', 'private', 'usdc',
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 10000000, '2026-12-10T00:00:00Z', 86400, 3, '2026-12-10T00:00:00Z',
  2, 10, 1000000, 1, 3600, 3600, 3600, '{}', repeat('44', 32));

do $$
declare v0 bigint; v1 bigint; v2 bigint; v3 bigint; v4 bigint; v5 bigint;
begin
  v0 := pg_temp.version('b9000000-0000-0000-0000-000000000001');
  assert v0 = 1, 'a new challenge gets an activity row';
  insert into public.memberships (id, challenge_id, profile_id, wallet_address, deposited) values
    ('b9100000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000052', 'Dd5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000);
  v1 := pg_temp.version('b9000000-0000-0000-0000-000000000001');
  assert v1 > v0, 'a join bumps the version';
  insert into public.day_results (membership_id, day, result, evidence_hash) values ('b9100000-0000-0000-0000-000000000001', 0, 'failed', repeat('0', 64));
  v2 := pg_temp.version('b9000000-0000-0000-0000-000000000001');
  assert v2 > v1, 'a day result bumps it';
  insert into public.shields (membership_id, day, price_paid, tx_signature) values ('b9100000-0000-0000-0000-000000000001', 0, 1000000, repeat('Y', 87));
  v3 := pg_temp.version('b9000000-0000-0000-0000-000000000001');
  assert v3 > v2, 'a Shield bumps it';
  update public.memberships set share_checks = false where id = 'b9100000-0000-0000-0000-000000000001';
  v4 := pg_temp.version('b9000000-0000-0000-0000-000000000001');
  assert v4 > v3, 'a member setting bumps it';
  update public.challenges set board_visibility = 'participants' where id = 'b9000000-0000-0000-0000-000000000001';
  v5 := pg_temp.version('b9000000-0000-0000-0000-000000000001');
  assert v5 > v4, 'an owner setting bumps it';
  assert exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'challenge_activity'), 'published to Realtime';
end $$;

-- Only people who can see the group receive its signal; nobody can forge one.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000053', false);
do $$ begin
  assert (select count(*) from public.challenge_activity where challenge_id = 'b9000000-0000-0000-0000-000000000001') = 0, 'an outsider sees no activity of a private group';
end $$;
select pg_temp.expect_fail('a user bumps activity', $q$ update public.challenge_activity set version = version + 1 $q$);
update public.challenges set board_visibility = 'viewers' where id = 'b9000000-0000-0000-0000-000000000001';  -- RLS: no update policy, 0 rows
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000052', false);
do $$ begin
  assert (select count(*) from public.challenge_activity where challenge_id = 'b9000000-0000-0000-0000-000000000001') = 1, 'a member sees it';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  assert (select board_visibility from public.challenges where id = 'b9000000-0000-0000-0000-000000000001') = 'participants', 'users cannot change the board visibility directly';
end $$;

-- Deleting a challenge cleans up without errors from the cascading triggers.
delete from public.challenges where id = 'b9000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select count(*) from public.challenge_activity where challenge_id = 'b9000000-0000-0000-0000-000000000001') = 0, 'activity removed with the challenge';
end $$;

\echo 'group board: all tests passed'
