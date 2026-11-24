-- Phase 31 tests: who may dispute and when, admin-only review and visibility, resolution on-chain mirror.
\set QUIET on
set client_min_messages = notice;

-- p1 plays in "Open" (dispute window still open) and "Closed" (window over); p2 is another player; a9 is the admin.
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2'), ('00000000-0000-0000-0000-0000000000b9');
insert into public.admins (profile_id) values ('00000000-0000-0000-0000-0000000000b9');
insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash, onchain_address, onchain_challenge_id, participant_count) values
  ('fa000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b9', 'Open window', 'public', 'sol', 'So11111111111111111111111111111111111111112', 10000000,
   now() - interval '32 minutes', 600, 3, now() - interval '33 minutes', 2, 10, 0, 0, 0, 600, 900, '{"providers":["github"]}', repeat('ab', 32),
   'Xo111111111111111111111111111111111111111111', 701, 2),
  ('fa000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b9', 'Closed window', 'public', 'sol', 'So11111111111111111111111111111111111111112', 10000000,
   now() - interval '3 hours', 600, 3, now() - interval '4 hours', 2, 10, 0, 0, 0, 600, 900, '{"providers":["github"]}', repeat('ab', 32),
   'Xc111111111111111111111111111111111111111111', 702, 2);
insert into public.memberships (id, challenge_id, profile_id, wallet_address, deposited) values
  ('fa100000-0000-0000-0000-000000000001', 'fa000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'Ga5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000),
  ('fa100000-0000-0000-0000-000000000002', 'fa000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'Gb5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000),
  ('fa100000-0000-0000-0000-000000000003', 'fa000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b1', 'Ga5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000);

-- Recorded results: p1 failed day 0 in both; p1 verified day 1 in "Open"; p2 failed day 0.
create temp table rc (m uuid, addr text, wallet text, day int, verdict text);
insert into rc values
  ('fa100000-0000-0000-0000-000000000001', 'Xo111111111111111111111111111111111111111111', 'Ga5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 0, 'failed'),
  ('fa100000-0000-0000-0000-000000000001', 'Xo111111111111111111111111111111111111111111', 'Ga5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 1, 'verified'),
  ('fa100000-0000-0000-0000-000000000002', 'Xo111111111111111111111111111111111111111111', 'Gb5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 0, 'failed'),
  ('fa100000-0000-0000-0000-000000000003', 'Xc111111111111111111111111111111111111111111', 'Ga5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 0, 'failed');
do $$
declare r record; body text; i int := 0;
begin
  for r in select * from rc loop
    i := i + 1;
    body := format('{"challenge":"%s","day":%s,"engine":"codestreak-rules/1","member":"%s","verdict":"%s"}', r.addr, r.day, r.wallet, r.verdict);
    perform public.save_day_result(r.m, r.day::smallint, r.verdict::public.day_result, encode(sha256(convert_to(body, 'UTF8')), 'hex'), 'codestreak-rules/1', body, '[]', null);
    perform public.mark_day_recorded(r.m, r.day::smallint, '7' || repeat(i::text, 86));
  end loop;
end $$;

create temp table ids (name text primary key, id uuid);
grant all on ids to authenticated;

-- ---- as player 1
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$
declare d uuid;
begin
  d := public.open_dispute('fa100000-0000-0000-0000-000000000001', 0::smallint, 'I pushed a 40-line commit at 10:05, GitHub was slow to show it.', array['https://github.com/me/repo/commit/abc']);
  insert into ids values ('p1', d);
  assert (select status from public.disputes where id = d) = 'open', 'ticket opened';
  assert (select count(*) from public.dispute_events where dispute_id = d and action = 'opened') = 1, 'timeline started';

  -- Rejected cases, with their messages.
  begin perform public.open_dispute('fa100000-0000-0000-0000-000000000001', 0::smallint, 'Second ticket for the same day, please.', '{}');
    raise exception 'NOT REJECTED: two live tickets'; exception when unique_violation then null; end;
  begin perform public.open_dispute('fa100000-0000-0000-0000-000000000003', 0::smallint, 'The window is over but I still want this.', '{}');
    raise exception 'NOT REJECTED: dispute after the window';
  exception when invalid_parameter_value then
    assert sqlerrm like 'The dispute window closed on %', sqlerrm;
  end;
  begin perform public.open_dispute('fa100000-0000-0000-0000-000000000002', 0::smallint, 'Disputing someone else''s day for them.', '{}');
    raise exception 'NOT REJECTED: someone else''s day'; exception when insufficient_privilege then null; end;
  begin perform public.open_dispute('fa100000-0000-0000-0000-000000000001', 1::smallint, 'This day is fine but let me try anyway.', '{}');
    raise exception 'NOT REJECTED: a verified day'; exception when invalid_parameter_value then null; end;
  begin perform public.open_dispute('fa100000-0000-0000-0000-000000000001', 2::smallint, 'This day has no recorded result at all yet.', '{}');
    raise exception 'NOT REJECTED: an unrecorded day'; exception when invalid_parameter_value then null; end;
  begin perform public.open_dispute('fa100000-0000-0000-0000-000000000001', 0::smallint, 'too short', '{}');
    raise exception 'NOT REJECTED: short reason'; exception when invalid_parameter_value then null; end;
  begin perform public.open_dispute('fa100000-0000-0000-0000-000000000001', 0::smallint, 'A link that is not https is not evidence.', array['javascript:alert(1)']);
    raise exception 'NOT REJECTED: bad link'; exception when invalid_parameter_value then null; end;

  -- Players can't review, and aren't admins.
  assert not public.am_i_admin(), 'not an admin';
  begin perform public.review_dispute(d, true, 'approving my own');
    raise exception 'NOT REJECTED: a player reviewed'; exception when insufficient_privilege then null; end;
end $$;

-- ---- as player 2: opens their own, can't see player 1's
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
do $$
begin
  insert into ids values ('p2', public.open_dispute('fa100000-0000-0000-0000-000000000002', 0::smallint, 'My LeetCode solve at 23:58 was not counted.', '{}'));
  assert (select count(*) from public.disputes) = 1, 'sees only their own ticket';
  assert (select count(*) from public.dispute_events) = 1, 'and only its timeline';
end $$;

-- ---- as the admin: sees everything, approves one, rejects the other
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b9', false);
do $$
begin
  assert public.am_i_admin(), 'admin';
  assert (select count(*) from public.disputes where id in (select id from ids)) = 2 and (select count(*) from public.disputes) >= 2, 'admin sees every ticket';
  assert public.review_dispute((select id from ids where name = 'p1'), true, 'Commit confirmed on GitHub.') = 'approved', 'approved';
  assert public.review_dispute((select id from ids where name = 'p2'), false, 'The solve was after midnight.') = 'rejected', 'rejected';
  begin perform public.review_dispute((select id from ids where name = 'p2'), true, 'changed my mind');
    raise exception 'NOT REJECTED: reviewing twice'; exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- ---- the worker: dispute work comes first, then the upgrade replaces the receipt and the day is verified
do $$
declare d uuid := (select id from ids where name = 'p1'); body text; h text;
begin
  assert (select reason from public.verification_work(50) where address = 'Xo111111111111111111111111111111111111111111') = 'dispute', 'dispute work first';
  body := format('{"challenge":"Xo111111111111111111111111111111111111111111","day":0,"dispute":"%s","engine":"codestreak-dispute/1","member":"Ga5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa","verdict":"verified"}', d);
  h := encode(sha256(convert_to(body, 'UTF8')), 'hex');
  perform public.resolve_dispute(d, '8' || repeat('9', 86), body, h);
  perform public.resolve_dispute(d, '8' || repeat('9', 86), body, h); -- idempotent
  assert (select status from public.disputes where id = d) = 'resolved', 'resolved';
  assert (select result = 'verified' and evidence_hash = h from public.day_results where membership_id = 'fa100000-0000-0000-0000-000000000001' and day = 0), 'day upgraded';
  assert (select engine from public.day_receipts where membership_id = 'fa100000-0000-0000-0000-000000000001' and day = 0) = 'codestreak-dispute/1', 'dispute receipt stored';
  assert (select count(*) from public.dispute_events where dispute_id = d) = 3, 'opened, approved, resolved';
  assert (select count(*) from public.audit_log where entity_type = 'dispute' and entity_id = d::text) = 3, 'audit trail';
  assert not exists (select 1 from public.verification_work(50) where reason = 'dispute'), 'no dispute work left';
end $$;
-- The deferred receipt checks pass at commit (we are in autocommit: they already ran).

-- Only the worker resolves; anonymous users see nothing.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', false);
do $$ begin
  perform public.resolve_dispute(gen_random_uuid(), null, '{}', repeat('0', 64));
  raise exception 'NOT REJECTED: a user resolved a dispute';
exception when insufficient_privilege then null;
end $$;
reset role;
set role anon;
do $$ begin
  assert (select count(*) from public.disputes) = 0 and (select count(*) from public.dispute_events) = 0, 'anon sees no disputes';
exception when insufficient_privilege then null;  -- or is refused outright
end $$;
reset role;

do $$ begin raise notice '99g_disputes_test: all passed'; end $$;
