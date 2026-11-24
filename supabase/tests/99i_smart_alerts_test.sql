-- Phase 33 tests: who is notified (and who isn't), dedupe, RLS isolation, read state, Realtime,
-- UTC deadline warnings only for unverified days.
\set QUIET on
set client_min_messages = notice;

-- creator k9, players k1 (unverified) and k2 (verified today), outsider k8.
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a5'), ('00000000-0000-0000-0000-0000000000a6'), ('00000000-0000-0000-0000-0000000000a7'), ('00000000-0000-0000-0000-0000000000a8');
update public.profiles set username = 'creator33' where id = '00000000-0000-0000-0000-0000000000a5';
update public.profiles set username = 'alice33' where id = '00000000-0000-0000-0000-0000000000a6';
update public.profiles set username = 'bob33' where id = '00000000-0000-0000-0000-0000000000a7';

-- Day length 600 s; now is 2 min before day 2 ends (lead for 600 s days = 150 s).
insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash, onchain_address, onchain_challenge_id, participant_count) values
  ('fc000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a5', 'Alerts group', 'public', 'sol', 'So11111111111111111111111111111111111111112', 10000000,
   now() - interval '18 minutes', 600, 3, now() - interval '19 minutes', 2, 10, 2000000, 1, 300, 600, 900, '{"providers":["github"]}', repeat('ab', 32),
   'Ax111111111111111111111111111111111111111111', 990, 2);
insert into public.memberships (id, challenge_id, profile_id, wallet_address, deposited) values
  ('fc100000-0000-0000-0000-000000000001', 'fc000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a6', 'Ka5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000),
  ('fc100000-0000-0000-0000-000000000002', 'fc000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a7', 'Kb5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000);

do $$
declare body text;
begin
  -- Joins notify the creator only (not the joiner, not each other).
  assert (select count(*) from public.notifications where challenge_id = 'fc000000-0000-0000-0000-000000000001' and kind = 'member_joined' and profile_id = '00000000-0000-0000-0000-0000000000a5') = 2, 'creator told about both joins';
  assert (select title from public.notifications where dedupe_key = 'joined:fc100000-0000-0000-0000-000000000001') = '@alice33 joined Alerts group', 'join title';
  assert not exists (select 1 from public.notifications where challenge_id = 'fc000000-0000-0000-0000-000000000001' and kind = 'member_joined' and profile_id <> '00000000-0000-0000-0000-0000000000a5'), 'joiners not notified';

  -- Bob's day 2 (index 1) is verified on-chain: Bob is told, once, even if the row is touched again.
  body := '{"challenge":"Ax111111111111111111111111111111111111111111","day":1,"engine":"codestreak-rules/1","member":"Kb5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa","verdict":"verified"}';
  perform public.save_day_result('fc100000-0000-0000-0000-000000000002', 1::smallint, 'verified', encode(sha256(convert_to(body, 'UTF8')), 'hex'), 'codestreak-rules/1', body, '[]', null);
  assert not exists (select 1 from public.notifications where challenge_id = 'fc000000-0000-0000-0000-000000000001' and kind = 'day_result'), 'nothing before it is on-chain';
  perform public.mark_day_recorded('fc100000-0000-0000-0000-000000000002', 1::smallint, '2' || repeat('3', 86));
  update public.day_results set onchain_at = now() where membership_id = 'fc100000-0000-0000-0000-000000000002' and day = 1;
  assert (select count(*) from public.notifications where challenge_id = 'fc000000-0000-0000-0000-000000000001' and kind = 'day_result') = 1, 'one result notification';
  assert (select profile_id from public.notifications where challenge_id = 'fc000000-0000-0000-0000-000000000001' and kind = 'day_result') = '00000000-0000-0000-0000-0000000000a7', 'to the player';
  assert (select title from public.notifications where challenge_id = 'fc000000-0000-0000-0000-000000000001' and kind = 'day_result') = 'Day 2 verified · Alerts group', 'result title';

  -- Sponsorship: creator and both players (the anonymous sponsor has no profile).
  insert into public.sponsorships (challenge_id, sponsor_id, sponsor_wallet, amount, message, tx_signature)
  values ('fc000000-0000-0000-0000-000000000001', null, 'Kz5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 5000000, 'Go team', '3' || repeat('4', 86));
  assert (select count(*) from public.notifications where challenge_id = 'fc000000-0000-0000-0000-000000000001' and kind = 'sponsorship') = 3, 'creator + 2 players';
  assert (select title from public.notifications where challenge_id = 'fc000000-0000-0000-0000-000000000001' and kind = 'sponsorship' limit 1) = 'A sponsor added 0.005 SOL to Alerts group', 'amount formatted';
end $$;

-- ---- UTC deadline math
do $$ begin
  assert private.warning_lead_secs(86400) = 10800, '3 hours for a real day';
  assert private.warning_lead_secs(43200) = 10800, '3 hours from 12 h days';
  assert private.warning_lead_secs(600) = 150, 'a quarter of a demo day';
  assert private.warning_lead_secs(120) = 60, 'at least a minute';
end $$;

-- ---- deadline warnings: only the unverified player, once (other test files' challenges may run too,
-- so this counts only this challenge's warnings)
create or replace function pg_temp.warnings() returns bigint language sql as $$
  select count(*) from public.notifications where challenge_id = 'fc000000-0000-0000-0000-000000000001' and kind = 'deadline_warning' $$;
do $$
declare start_at timestamptz := (select c.start_at from public.challenges c where c.id = 'fc000000-0000-0000-0000-000000000001');
begin
  -- 3 minutes before day 2 ends: outside the 150 s lead, nobody warned.
  perform private.send_deadline_warnings(start_at + interval '17 minutes');
  assert pg_temp.warnings() = 0, 'too early';
  -- 2 minutes before: Alice (unverified) is warned; Bob (verified) is not.
  perform private.send_deadline_warnings(start_at + interval '18 minutes');
  assert pg_temp.warnings() = 1, format('one warning, got %s', pg_temp.warnings());
  assert (select profile_id from public.notifications where challenge_id = 'fc000000-0000-0000-0000-000000000001' and kind = 'deadline_warning') = '00000000-0000-0000-0000-0000000000a6', 'to the unverified player';
  assert (select title from public.notifications where challenge_id = 'fc000000-0000-0000-0000-000000000001' and kind = 'deadline_warning') =
         'Day 2 of Alerts group ends at ' || to_char((start_at + interval '20 minutes') at time zone 'UTC', 'HH24:MI') || ' UTC', 'UTC end time in the title';
  -- Again a minute later: deduplicated.
  perform private.send_deadline_warnings(start_at + interval '19 minutes');
  assert pg_temp.warnings() = 1, 'no duplicate';
  -- Day 3, 1 minute before its end: Alice has a Shield, Bob's check met the goal: nobody.
  insert into public.shields (membership_id, day, price_paid, tx_signature) values ('fc100000-0000-0000-0000-000000000001', 2, 2000000, '4' || repeat('5', 86));
  insert into public.member_day_checks (membership_id, day, provider, lines, goal, outcome, complete) values ('fc100000-0000-0000-0000-000000000002', 2, 'github', 50, 10, 'met', true);
  perform private.send_deadline_warnings(start_at + interval '29 minutes');
  assert pg_temp.warnings() = 1, 'shielded and met players not warned';
  -- After the challenge ended: nothing.
  perform private.send_deadline_warnings(start_at + interval '31 minutes');
  assert pg_temp.warnings() = 1, 'no warnings after the last day';
end $$;

-- ---- settlement and payout
do $$ begin
  update public.challenges set pool_state = 'settled' where id = 'fc000000-0000-0000-0000-000000000001';
  update public.challenges set title = 'Alerts group!' where id = 'fc000000-0000-0000-0000-000000000001';
  assert (select count(*) from public.notifications where challenge_id = 'fc000000-0000-0000-0000-000000000001' and kind = 'settlement') = 2, 'both players told once';
  insert into public.receipts (challenge_id, profile_id, wallet, kind, amount, tx_signature)
  values ('fc000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a7', 'Kb5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'reward', 20000000, '5' || repeat('6', 86));
  assert (select title from public.notifications where challenge_id = 'fc000000-0000-0000-0000-000000000001' and kind = 'payout') = 'Your reward of 0.02 SOL arrived', 'payout title';
  assert (select profile_id from public.notifications where challenge_id = 'fc000000-0000-0000-0000-000000000001' and kind = 'payout') = '00000000-0000-0000-0000-0000000000a7', 'to the paid player';
end $$;

-- ---- Realtime publishes the table (RLS-filtered per subscriber)
do $$ begin
  assert exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'), 'in the realtime publication';
end $$;

-- ---- RLS isolation and read state
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a6', false);
do $$
declare mine integer := (select count(*) from public.notifications);
begin
  assert mine > 0 and mine = (select count(*) from public.notifications where profile_id = '00000000-0000-0000-0000-0000000000a6'), 'Alice sees only her own';
  begin
    update public.notifications set read_at = now();
    raise exception 'NOT REJECTED: direct update';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.notifications (profile_id, kind, title, dedupe_key) values ('00000000-0000-0000-0000-0000000000a7', 'badge', 'fake', 'x');
    raise exception 'NOT REJECTED: forged notification';
  exception when insufficient_privilege then null;
  end;
  -- Marking someone else's notification read does nothing.
  assert public.mark_notifications_read(array[(select id from public.notifications limit 0)]::uuid[]) = 0, 'empty list';
  assert public.mark_notifications_read(null) = mine, 'all of hers marked read';
  assert public.mark_notifications_read(null) = 0, 'idempotent';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a8', false);
do $$ begin
  assert (select count(*) from public.notifications) = 0, 'outsider sees nothing';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notifications where profile_id = '00000000-0000-0000-0000-0000000000a7' and read_at is not null) = 0, 'Bob''s stay unread';
end $$;
set role anon;
do $$ begin
  perform public.mark_notifications_read(null);
  raise exception 'NOT REJECTED: anon marked read';
exception when insufficient_privilege then null;
end $$;
reset role;

do $$ begin raise notice '99i_smart_alerts_test: all passed'; end $$;
