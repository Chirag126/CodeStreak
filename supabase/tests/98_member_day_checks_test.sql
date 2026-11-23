-- Day checks: visibility follows "share check details" and "players only", in the database.
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

-- 81 creator, 82 Ana (shares), 83 Bo (hides details), 84 outsider
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000081'), ('00000000-0000-0000-0000-000000000082'), ('00000000-0000-0000-0000-000000000083'), ('00000000-0000-0000-0000-000000000084');
insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash)
values ('e4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000081', 'Checks', 'public', 'usdc',
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 10000000, '2026-12-10T00:00:00Z', 86400, 3, '2026-12-10T00:00:00Z',
  2, 10, 0, 0, 0, 3600, 3600, '{}', repeat('77', 32));
insert into public.memberships (id, challenge_id, profile_id, wallet_address, deposited, share_checks) values
  ('e4100000-0000-0000-0000-000000000082', 'e4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000082', 'Jj5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000, true),
  ('e4100000-0000-0000-0000-000000000083', 'e4000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000083', 'Kk5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000, false);
insert into public.member_day_checks (membership_id, day, lines, goal, outcome, complete) values
  ('e4100000-0000-0000-0000-000000000082', 0, 8, 15, 'not_met', true),
  ('e4100000-0000-0000-0000-000000000083', 0, 20, 15, 'met', true);
insert into public.evidence (membership_id, day, provider, kind, external_id, occurred_at, counted, reason) values
  ('e4100000-0000-0000-0000-000000000082', 0, 'github', 'commit', repeat('a', 40), now(), true, 'counted'),
  ('e4100000-0000-0000-0000-000000000083', 0, 'github', 'commit', repeat('b', 40), now(), true, 'counted');

select pg_temp.expect_fail('outcome outside the list', $q$ insert into public.member_day_checks (membership_id, day, lines, goal, outcome, complete) values ('e4100000-0000-0000-0000-000000000082', 1, 1, 15, 'verified', true) $q$);
select pg_temp.expect_fail('zero goal', $q$ insert into public.member_day_checks (membership_id, day, lines, goal, outcome, complete) values ('e4100000-0000-0000-0000-000000000082', 1, 1, 0, 'met', true) $q$);
select pg_temp.expect_fail('hints not a list', $q$ insert into public.member_day_checks (membership_id, day, lines, goal, outcome, complete, hints) values ('e4100000-0000-0000-0000-000000000082', 1, 1, 15, 'met', true, '{"a":1}') $q$);

create function pg_temp.seen(who text) returns table (checks bigint, evidence bigint) language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', who, true);
  return query
    select (select count(*) from public.member_day_checks where membership_id::text like 'e4100000-%'),
           (select count(*) from public.evidence where membership_id::text like 'e4100000-%');
end $$;

set role authenticated;
do $$
declare r record;
begin
  select * into r from pg_temp.seen('00000000-0000-0000-0000-000000000084');
  assert r.checks = 1 and r.evidence = 1, format('an outsider of a public board sees only shared checks: %s', r);
  select * into r from pg_temp.seen('00000000-0000-0000-0000-000000000083');
  assert r.checks = 2 and r.evidence = 2, format('Bo sees his own hidden details and Ana''s shared ones: %s', r);
  select * into r from pg_temp.seen('00000000-0000-0000-0000-000000000081');
  assert r.checks = 1, format('even the creator can''t see details Bo hid: %s', r);
end $$;
reset role;

-- Players only: outsiders see nothing, players and the creator still see shared checks.
update public.challenges set board_visibility = 'participants' where id = 'e4000000-0000-0000-0000-000000000001';
set role authenticated;
do $$
declare r record;
begin
  select * into r from pg_temp.seen('00000000-0000-0000-0000-000000000084');
  assert r.checks = 0 and r.evidence = 0, format('players-only board: an outsider sees no checks: %s', r);
  select * into r from pg_temp.seen('00000000-0000-0000-0000-000000000082');
  assert r.checks = 1, format('a player sees shared checks (her own): %s', r);
  select * into r from pg_temp.seen('00000000-0000-0000-0000-000000000081');
  assert r.checks = 1, format('the creator sees shared checks: %s', r);
end $$;
select pg_temp.expect_fail('a user writes a check', $q$ insert into public.member_day_checks (membership_id, day, lines, goal, outcome, complete) values ('e4100000-0000-0000-0000-000000000082', 2, 99, 15, 'met', true) $q$);
reset role;
select set_config('request.jwt.claim.sub', '', false);

do $$ begin
  assert (select version from public.challenge_activity where challenge_id = 'e4000000-0000-0000-0000-000000000001') > 3, 'checks bump the live board';
end $$;

\echo 'member day checks: all tests passed'
