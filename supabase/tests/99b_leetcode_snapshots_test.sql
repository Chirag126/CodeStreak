-- Phase 26 tests: LeetCode snapshots and scheduled targets.
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

-- A1 in a running LeetCode challenge, A2 in a GitHub-only one, A3 in LeetCode but finished.
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2'), ('00000000-0000-0000-0000-0000000000a3'), ('00000000-0000-0000-0000-0000000000a9');
insert into public.linked_accounts (profile_id, provider, provider_user_id, provider_username) values
  ('00000000-0000-0000-0000-0000000000a1', 'leetcode', 'ana', 'Ana'),
  ('00000000-0000-0000-0000-0000000000a2', 'leetcode', 'bo', 'bo'),
  ('00000000-0000-0000-0000-0000000000a3', 'leetcode', 'cy', 'cy');
insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash) values
  ('f5000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a9', 'LeetCode run', 'public', 'usdc', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 1000000,
   now() - interval '1 hour', 86400, 3, now() - interval '1 hour', 2, 10, 0, 0, 0, 3600, 3600, '{"providers":["leetcode"]}', repeat('88', 32)),
  ('f5000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a9', 'GitHub run', 'public', 'usdc', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 1000000,
   now() - interval '1 hour', 86400, 3, now() - interval '1 hour', 2, 10, 0, 0, 0, 3600, 3600, '{"providers":["github"]}', repeat('89', 32)),
  ('f5000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a9', 'Old', 'public', 'usdc', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 1000000,
   now() - interval '10 days', 86400, 3, now() - interval '10 days', 2, 10, 0, 0, 0, 3600, 3600, '{"providers":["leetcode"]}', repeat('8a', 32));
insert into public.memberships (challenge_id, profile_id, wallet_address, deposited) values
  ('f5000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'Mm5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 1000000),
  ('f5000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2', 'Nn5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 1000000),
  ('f5000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a3', 'Pp5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 1000000);

do $$ begin
  assert (select array_agg(handle) from public.leetcode_snapshot_targets()) = array['ana'], 'only people in a running LeetCode challenge are due';
end $$;
insert into public.leetcode_snapshots (profile_id, handle, source, readable, solved, has_history, recent)
values ('00000000-0000-0000-0000-0000000000a1', 'ana', 'scheduled', true, 10, true, '[{"id":"1","title":"Two Sum","ago":"a day ago"}]');
do $$ begin
  assert (select count(*) from public.leetcode_snapshot_targets()) = 0, 'a fresh snapshot is not due again';
end $$;

select pg_temp.expect_fail('unreadable snapshot with data', $q$ insert into public.leetcode_snapshots (profile_id, handle, source, readable, solved) values ('00000000-0000-0000-0000-0000000000a1', 'ana', 'manual', false, 5) $q$);
select pg_temp.expect_fail('capitalised handle', $q$ insert into public.leetcode_snapshots (profile_id, handle, source, readable) values ('00000000-0000-0000-0000-0000000000a1', 'Ana', 'manual', false) $q$);
select pg_temp.expect_fail('negative solved count', $q$ insert into public.leetcode_snapshots (profile_id, handle, source, readable, solved) values ('00000000-0000-0000-0000-0000000000a1', 'ana', 'manual', true, -1) $q$);

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select pg_temp.expect_fail('a user reads snapshots', $q$ select * from public.leetcode_snapshots $q$);
select pg_temp.expect_fail('a user lists snapshot targets', $q$ select * from public.leetcode_snapshot_targets() $q$);
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo 'leetcode snapshots: all tests passed'
