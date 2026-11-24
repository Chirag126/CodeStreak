-- Phase 11 tests: schema B constraints, one-way results, append-only audit log, and two-user RLS
-- (a non-member can't read a private group). Independent fixtures (users d, e, f).
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
-- d: creator + member of the private group; e: member; f: outsider (member of the public one only)
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000d'), ('00000000-0000-0000-0000-00000000000e'),
  ('00000000-0000-0000-0000-00000000000f');

insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs,
  num_days, join_deadline_at, min_participants, max_participants, verify_window_secs, dispute_window_secs, rules, rules_hash)
values
  ('b0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d', 'Private squad', 'private', 'usdc',
   '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 5000000, '2026-12-01T00:00:00Z', 86400, 3, '2026-11-30T00:00:00Z',
   2, 10, 3600, 3600, '{"v":1}', repeat('ef', 32)),
  ('b0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000d', 'Open arena', 'public', 'usdc',
   '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 5000000, '2026-12-01T00:00:00Z', 86400, 3, '2026-11-30T00:00:00Z',
   2, 10, 3600, 3600, '{"v":1}', repeat('fe', 32));

insert into public.memberships (id, challenge_id, profile_id, wallet_address, deposited) values
  ('b1000000-0000-0000-0000-00000000000d', 'b0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000d',
   'Dd5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 5000000),
  ('b1000000-0000-0000-0000-00000000000e', 'b0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000e',
   'Ee5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 5000000),
  ('b1000000-0000-0000-0000-00000000000f', 'b0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000f',
   'Ff5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 5000000);

insert into public.verification_runs (id, challenge_id, day, triggered_by, status, finished_at, checked_count) values
  ('b2000000-0000-0000-0000-00000000000a', 'b0000000-0000-0000-0000-00000000000a', 0, 'scheduled', 'succeeded', now(), 2),
  ('b2000000-0000-0000-0000-00000000000b', 'b0000000-0000-0000-0000-00000000000b', 0, 'scheduled', 'succeeded', now(), 1);

insert into public.evidence (membership_id, run_id, day, provider, kind, external_id, occurred_at, diff_hash, counted, reason) values
  ('b1000000-0000-0000-0000-00000000000e', 'b2000000-0000-0000-0000-00000000000a', 0, 'github', 'commit',
   repeat('a', 40), '2026-12-01T10:00:00Z', repeat('1', 64), true, 'qualifying push'),
  ('b1000000-0000-0000-0000-00000000000f', 'b2000000-0000-0000-0000-00000000000b', 0, 'leetcode', 'submission',
   '1234567', '2026-12-01T11:00:00Z', null, true, 'accepted submission');

insert into public.day_results (id, membership_id, day, result, evidence_count, evidence_hash) values
  ('b3000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-00000000000d', 0, 'failed', 0, repeat('0', 64)),
  ('b3000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-00000000000e', 0, 'verified', 1, repeat('1', 64)),
  ('b3000000-0000-0000-0000-000000000003', 'b1000000-0000-0000-0000-00000000000e', 1, 'indeterminate', 0, repeat('2', 64)),
  ('b3000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-00000000000f', 0, 'verified', 1, repeat('3', 64));

insert into public.receipts (challenge_id, profile_id, wallet, kind, amount, tx_signature) values
  ('b0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000e', 'Ee5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa',
   'join', 5000000, repeat('A', 87)),
  ('b0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000f', 'Ff5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa',
   'join', 5000000, repeat('B', 87));

insert into public.disputes (membership_id, day, opened_by, reason, previous_result, previous_hash) values
  ('b1000000-0000-0000-0000-00000000000d', 0, '00000000-0000-0000-0000-00000000000d', 'My push was on time, GitHub was slow.', 'failed', repeat('1', 64));

insert into public.audit_log (actor_kind, actor_id, action, entity_type, entity_id) values
  ('user', '00000000-0000-0000-0000-00000000000e', 'challenge.join', 'challenge', 'b0000000-0000-0000-0000-00000000000a'),
  ('worker', null, 'verification.run', 'challenge', 'b0000000-0000-0000-0000-00000000000a');

insert into public.voice_clips (profile_id, challenge_id, kind, script, voice_id, storage_path) values
  ('00000000-0000-0000-0000-00000000000e', 'b0000000-0000-0000-0000-00000000000a', 'morning', 'Good morning! Day 2.', 'voice123', 'clips/e/morning-1.mp3');

insert into public.badge_types (code, name, description) values ('first_streak', 'First streak', 'Survived a first challenge.');
insert into public.badges (profile_id, badge_code) values ('00000000-0000-0000-0000-00000000000e', 'first_streak');

-- ---------------------------------------------------------------- structure
do $$
begin
  assert not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity), 'RLS on every table';
  assert (select bool_and('security_invoker=true' = any (reloptions)) from pg_class
          where relname in ('challenge_standings', 'leaderboard') and relkind = 'v'), 'views run with caller RLS';
  assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')),
         'no SECURITY DEFINER function in public is executable by anon';
end $$;

-- ---------------------------------------------------------------- constraints
select pg_temp.expect_fail('Verified -> Failed', $q$
  update public.day_results set result = 'failed' where id = 'b3000000-0000-0000-0000-000000000002' $q$);
select pg_temp.expect_fail('Verified -> Indeterminate', $q$
  update public.day_results set result = 'indeterminate' where id = 'b3000000-0000-0000-0000-000000000002' $q$);
select pg_temp.expect_fail('Failed -> Indeterminate', $q$
  update public.day_results set result = 'indeterminate' where id = 'b3000000-0000-0000-0000-000000000001' $q$);
select pg_temp.expect_fail('Indeterminate -> Failed', $q$
  update public.day_results set result = 'failed' where id = 'b3000000-0000-0000-0000-000000000003' $q$);
select pg_temp.expect_fail('moving a result to another day', $q$
  update public.day_results set day = 2 where id = 'b3000000-0000-0000-0000-000000000003' $q$);
select pg_temp.expect_fail('second result for the same member-day', $q$
  insert into public.day_results (membership_id, day, result, evidence_hash)
  values ('b1000000-0000-0000-0000-00000000000e', 0, 'failed', repeat('4', 64)) $q$);
update public.day_results set result = 'verified', source = 'dispute' where id = 'b3000000-0000-0000-0000-000000000001';
update public.day_results set result = 'verified' where id = 'b3000000-0000-0000-0000-000000000003';

select pg_temp.expect_fail('same commit considered twice', $q$
  insert into public.evidence (membership_id, day, provider, kind, external_id, occurred_at, diff_hash, counted, reason)
  values ('b1000000-0000-0000-0000-00000000000e', 1, 'github', 'commit', repeat('a', 40), now(), repeat('5', 64), true, 'again') $q$);
select pg_temp.expect_fail('same diff counted twice under a new SHA', $q$
  insert into public.evidence (membership_id, day, provider, kind, external_id, occurred_at, diff_hash, counted, reason)
  values ('b1000000-0000-0000-0000-00000000000e', 1, 'github', 'commit', repeat('b', 40), now(), repeat('1', 64), true, 'repush') $q$);
insert into public.evidence (membership_id, day, provider, kind, external_id, occurred_at, diff_hash, counted, reason)
  values ('b1000000-0000-0000-0000-00000000000e', 1, 'github', 'commit', repeat('c', 40), now(), repeat('1', 64), false, 'duplicate diff');
select pg_temp.expect_fail('LeetCode evidence marked as a commit', $q$
  insert into public.evidence (membership_id, day, provider, kind, external_id, occurred_at, counted, reason)
  values ('b1000000-0000-0000-0000-00000000000e', 1, 'leetcode', 'commit', '99', now(), true, 'x') $q$);

select pg_temp.expect_fail('fractional receipt', $q$
  insert into public.receipts (challenge_id, wallet, kind, amount, tx_signature)
  values ('b0000000-0000-0000-0000-00000000000a', 'Ee5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'sponsor', 1.5, repeat('C', 87)) $q$);
select pg_temp.expect_fail('negative receipt', $q$
  insert into public.receipts (challenge_id, wallet, kind, amount, tx_signature)
  values ('b0000000-0000-0000-0000-00000000000a', 'Ee5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'sponsor', -1, repeat('C', 87)) $q$);
select pg_temp.expect_fail('receipt tx recorded twice', $q$
  insert into public.receipts (challenge_id, wallet, kind, amount, tx_signature)
  values ('b0000000-0000-0000-0000-00000000000a', 'Ee5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'reward', 1, repeat('A', 87)) $q$);

-- Disputes (reworked in Phase 31: see 99g_disputes_test.sql).
select pg_temp.expect_fail('two open disputes for one member-day', $q$
  insert into public.disputes (membership_id, day, opened_by, reason, previous_result, previous_hash)
  values ('b1000000-0000-0000-0000-00000000000d', 0, '00000000-0000-0000-0000-00000000000d', 'Opening it a second time, please.', 'failed', repeat('1', 64)) $q$);
select pg_temp.expect_fail('dispute reason too short', $q$
  insert into public.disputes (membership_id, day, opened_by, reason, previous_result, previous_hash)
  values ('b1000000-0000-0000-0000-00000000000d', 1, '00000000-0000-0000-0000-00000000000d', 'pls', 'failed', repeat('1', 64)) $q$);

select pg_temp.expect_fail('audit log update', $q$ update public.audit_log set action = 'tampered' $q$);
select pg_temp.expect_fail('audit log delete', $q$ delete from public.audit_log $q$);
select pg_temp.expect_fail('audit log truncate', $q$ truncate public.audit_log $q$);

select pg_temp.expect_fail('badge awarded twice', $q$
  insert into public.badges (profile_id, badge_code) values ('00000000-0000-0000-0000-00000000000e', 'first_streak') $q$);
select pg_temp.expect_fail('finished run without an end time', $q$
  update public.verification_runs set finished_at = null where id = 'b2000000-0000-0000-0000-00000000000a' $q$);

-- ---------------------------------------------------------------- two-user RLS
-- f is NOT a member of the private group: nothing of it is visible, through tables or views.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', false);
do $$
declare p uuid := 'b0000000-0000-0000-0000-00000000000a';
begin
  assert (select count(*) from public.challenges where id = p) = 0, 'outsider: private challenge hidden';
  assert (select count(*) from public.memberships where challenge_id = p) = 0, 'outsider: members hidden';
  assert (select count(*) from public.verification_runs where challenge_id = p) = 0, 'outsider: runs hidden';
  assert (select count(*) from public.evidence e join public.memberships m on m.id = e.membership_id
          where m.challenge_id = p) = 0, 'outsider: evidence hidden';
  assert (select count(*) from public.evidence where membership_id in
          ('b1000000-0000-0000-0000-00000000000d', 'b1000000-0000-0000-0000-00000000000e')) = 0, 'outsider: evidence by id hidden';
  assert (select count(*) from public.day_results where membership_id in
          ('b1000000-0000-0000-0000-00000000000d', 'b1000000-0000-0000-0000-00000000000e')) = 0, 'outsider: results hidden';
  assert (select count(*) from public.disputes) = 0, 'outsider: disputes hidden';
  assert (select count(*) from public.challenge_standings where challenge_id = p) = 0, 'outsider: standings view hidden';
  assert (select count(*) from public.receipts) = 1, 'outsider: only own receipt';
  assert (select count(*) from public.voice_clips) = 0, 'outsider: no one else''s clips';
  assert (select count(*) from public.audit_log) = 0, 'outsider: no one else''s audit entries';
  -- ...but the public challenge is fully readable.
  assert (select count(*) from public.challenges where id = 'b0000000-0000-0000-0000-00000000000b') = 1, 'public visible';
  assert (select count(*) from public.challenge_standings where challenge_id = 'b0000000-0000-0000-0000-00000000000b') = 1, 'public standings';
  assert (select verified_days from public.leaderboard where profile_id = '00000000-0000-0000-0000-00000000000f') = 1, 'leaderboard';
end $$;
select pg_temp.expect_fail('outsider cannot write results', $q$
  insert into public.day_results (membership_id, day, result, evidence_hash)
  values ('b1000000-0000-0000-0000-00000000000f', 2, 'verified', repeat('6', 64)) $q$);
select pg_temp.expect_fail('outsider cannot open disputes directly', $q$
  insert into public.disputes (membership_id, day, opened_by, reason, previous_result, previous_hash)
  values ('b1000000-0000-0000-0000-00000000000f', 1, '00000000-0000-0000-0000-00000000000f', 'Direct insert attempt, bypassing checks.', 'failed', repeat('1', 64)) $q$);

-- e IS a member: sees the private group's members, results, evidence and standings (not others' disputes).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
do $$
declare p uuid := 'b0000000-0000-0000-0000-00000000000a';
begin
  assert (select count(*) from public.challenges where id = p) = 1, 'member: private challenge visible';
  assert (select count(*) from public.memberships where challenge_id = p) = 2, 'member: both members visible';
  assert (select count(*) from public.day_results r join public.memberships m on m.id = r.membership_id
          where m.challenge_id = p) = 3, 'member: results visible';
  assert (select count(*) from public.evidence e join public.memberships m on m.id = e.membership_id
          where m.challenge_id = p) = 2, 'member: evidence visible';
  assert (select count(*) from public.disputes) = 0, 'member: another player''s dispute stays hidden (own or admin only)';
  assert (select count(*) from public.challenge_standings where challenge_id = p) = 2, 'member: standings';
  assert (select count(*) from public.voice_clips) = 1 and (select count(*) from public.audit_log) = 1, 'member: own clips and audit';
  assert (select count(*) from public.receipts) = 1, 'member: own receipt only';
end $$;
reset role;

-- Anonymous visitors see nothing of the private group either (an anonymous request has no user id).
select set_config('request.jwt.claim.sub', '', false);
set role anon;
do $$
begin
  assert (select count(*) from public.challenges where id = 'b0000000-0000-0000-0000-00000000000a') = 0, 'anon: private hidden';
  assert (select count(*) from public.day_results where membership_id = 'b1000000-0000-0000-0000-00000000000e') = 0, 'anon: results hidden';
  assert (select count(*) from public.badges) >= 1, 'anon: badges are public';
end $$;
reset role;

\echo 'schema_b: all constraint and two-user RLS tests passed'
