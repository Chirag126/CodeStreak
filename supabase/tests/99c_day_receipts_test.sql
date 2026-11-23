-- Phase 27 tests: receipts are bound to their day result by hash, verdict, day, wallet and challenge.
\set QUIET on
set client_min_messages = notice;

create function pg_temp.expect_fail(label text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
    set constraints all immediate;
  exception when others then
    raise notice 'rejected  %  [%: %]', label, sqlstate, left(sqlerrm, 90);
    return;
  end;
  raise exception 'NOT REJECTED: %', label;
end $$;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000c2');
insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash, onchain_address, onchain_challenge_id) values
  ('f6000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c2', 'Receipt run', 'public', 'usdc', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 1000000,
   now() - interval '3 days', 86400, 3, now() - interval '3 days', 2, 10, 0, 0, 0, 3600, 3600, '{"providers":["github"]}', repeat('ab', 32),
   'A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J', 777);
insert into public.memberships (id, challenge_id, profile_id, wallet_address, deposited) values
  ('f6100000-0000-0000-0000-000000000001', 'f6000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'Mm5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 1000000);

create temp table r (day int, verdict text, body text);
insert into r values
  (0, 'verified', '{"challenge":"A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J","day":0,"engine":"codestreak-rules/1","member":"Mm5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa","verdict":"verified"}'),
  (1, 'failed',   '{"challenge":"A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J","day":1,"engine":"codestreak-rules/1","member":"Mm5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa","verdict":"failed"}'),
  (2, 'failed',   '{"challenge":"A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J","day":2,"engine":"codestreak-rules/1","member":"SomeoneElse1111111111111111111111111111111","verdict":"failed"}');
create function pg_temp.h(t text) returns text language sql as $$ select encode(sha256(convert_to(t, 'UTF8')), 'hex') $$;

-- A matching result + receipt is accepted (written together in one transaction).
begin;
insert into public.day_results (membership_id, day, result, evidence_hash) select 'f6100000-0000-0000-0000-000000000001', day, verdict::public.day_result, pg_temp.h(body) from r where day = 0;
insert into public.day_receipts (membership_id, day, engine, receipt, evidence_hash) select 'f6100000-0000-0000-0000-000000000001', day, 'codestreak-rules/1', body, pg_temp.h(body) from r where day = 0;
commit;
do $$ begin
  assert (select count(*) from public.day_receipts) = 1, 'matching receipt stored';
end $$;

insert into public.day_results (membership_id, day, result, evidence_hash) select 'f6100000-0000-0000-0000-000000000001', 1, 'failed', pg_temp.h(body) from r where day = 1;
insert into public.day_results (membership_id, day, result, evidence_hash) select 'f6100000-0000-0000-0000-000000000001', 2, 'failed', pg_temp.h(body) from r where day = 2;

select pg_temp.expect_fail('receipt bytes edited (hash mismatch)', $q$
  insert into public.day_receipts (membership_id, day, engine, receipt, evidence_hash) select 'f6100000-0000-0000-0000-000000000001', 1, 'codestreak-rules/1', replace(body, 'failed', 'verified'), pg_temp.h(body) from r where day = 1 $q$);
select pg_temp.expect_fail('receipt for another day', $q$
  insert into public.day_receipts (membership_id, day, engine, receipt, evidence_hash) select 'f6100000-0000-0000-0000-000000000001', 1, 'codestreak-rules/1', body, pg_temp.h(body) from r where day = 0 $q$);
select pg_temp.expect_fail('receipt naming another wallet', $q$
  insert into public.day_receipts (membership_id, day, engine, receipt, evidence_hash) select 'f6100000-0000-0000-0000-000000000001', 2, 'codestreak-rules/1', body, pg_temp.h(body) from r where day = 2 $q$);
select pg_temp.expect_fail('result hash changed away from its receipt', $q$
  update public.day_results set evidence_hash = repeat('9', 64) where membership_id = 'f6100000-0000-0000-0000-000000000001' and day = 0 $q$);
select pg_temp.expect_fail('receipt without a day result', $q$
  insert into public.day_receipts (membership_id, day, engine, receipt, evidence_hash) values ('f6100000-0000-0000-0000-000000000001', 5, 'codestreak-rules/1', '{"day":5,"engine":"codestreak-rules/1"}', pg_temp.h('{"day":5,"engine":"codestreak-rules/1"}')) $q$);

-- The verdict must match: once day 1 has a "failed" receipt, its result can't become "verified"
-- without a new receipt.
insert into public.day_receipts (membership_id, day, engine, receipt, evidence_hash) select 'f6100000-0000-0000-0000-000000000001', 1, 'codestreak-rules/1', body, pg_temp.h(body) from r where day = 1;
select pg_temp.expect_fail('result verdict changed away from its receipt', $q$
  update public.day_results set result = 'verified' where membership_id = 'f6100000-0000-0000-0000-000000000001' and day = 1 $q$);
insert into public.member_day_checks (membership_id, day, provider, lines, goal, outcome, complete, pushes, commits, hints, notes, checked_by, checked_at)
values ('f6100000-0000-0000-0000-000000000001', 0, 'github', 1, 15, 'not_met', true, 0, 0, '[]', '[]', '00000000-0000-0000-0000-0000000000c1', now());
select pg_temp.expect_fail('confidence above 100', $q$ update public.member_day_checks set confidence = 101 $q$);

-- Visibility: receipts follow the member's sharing setting.
set role anon;
do $$ begin
  assert (select count(*) from public.day_receipts) = 2, 'a shared member''s receipts are visible';
end $$;
reset role;
update public.memberships set share_checks = false where id = 'f6100000-0000-0000-0000-000000000001';
set role anon;
do $$ begin
  assert (select count(*) from public.day_receipts) = 0, 'a private member''s receipt is hidden';
end $$;
select pg_temp.expect_fail('anon writes a receipt', $q$ delete from public.day_receipts $q$);
reset role;

-- The database hashes exactly the bytes the engine hashes (golden receipt from rules-engine.test.ts).
do $$ begin
  assert pg_temp.h('{"challenge":"A4ohMziwegRbnV2DFHKW1YkNoVNeeiWuCJS5MjWeJT7J","confidence":90,"day":2,"engine":"codestreak-rules/1","member":"Mm5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa","providers":[{"confidence":100,"evidence":[{"code":"counted","counted":true,"id":"c0ffee00","ref":"ana/api","value":12},{"code":"merge-commit","counted":false,"id":"deadbeef","ref":"ana/api"},{"code":"counted","counted":true,"id":"f00dbabe","ref":"ana/api","value":30}],"evidenceOmitted":0,"goal":15,"outcome":"met","provider":"github","quality":{"complete":true,"coveragePct":100,"gaps":0},"value":42},{"confidence":90,"evidence":[{"code":"new-solve","counted":true,"id":"2200000001","ref":"Merge Intervals","value":1}],"evidenceOmitted":0,"goal":1,"outcome":"met","provider":"leetcode","quality":{"complete":true,"coveragePct":90,"gaps":0},"value":1}],"reason":"all-met","rule":"all","rulesHash":"abababababababababababababababababababababababababababababababab","v":1,"verdict":"verified","window":{"end":1795086400,"start":1795000000}}') = '5ceb7001f738073452467a90680aad7ae2fe169e244fbef8aed1ea1471d23cba', 'database SHA-256 matches the engine';
end $$;

\echo 'day receipts: all tests passed'
