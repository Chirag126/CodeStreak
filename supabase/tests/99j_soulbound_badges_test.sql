-- Phase 34 tests: badge mirror (survivors only, one mint, idempotent), crank reason, public metadata.
\set QUIET on
set client_min_messages = notice;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000f8'), ('00000000-0000-0000-0000-0000000000f9');
update public.profiles set username = 'badge_winner' where id = '00000000-0000-0000-0000-0000000000f8';
insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash, onchain_address, onchain_challenge_id, participant_count, pool_state, payouts_done_at) values
  ('fd000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f8', 'Badge week', 'public', 'sol', 'So11111111111111111111111111111111111111112', 10000000,
   now() - interval '2 hours', 600, 3, now() - interval '3 hours', 2, 10, 2000000, 2, 300, 600, 900, '{"providers":["github"]}', repeat('cd', 32),
   'Bd111111111111111111111111111111111111111111', 902, 2, 'settled', now());
insert into public.memberships (id, challenge_id, profile_id, wallet_address, participant_address, deposited, status) values
  ('fd100000-0000-0000-0000-000000000001', 'fd000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f8',
   'Wn5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'Pw111111111111111111111111111111111111111111', 10000000, 'survived'),
  ('fd100000-0000-0000-0000-000000000002', 'fd000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f9',
   'Ls5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'Pf111111111111111111111111111111111111111111', 10000000, 'failed');

do $$
declare b uuid;
declare n integer;
begin
  assert exists (select 1 from public.verification_work(50) where challenge_id = 'fd000000-0000-0000-0000-000000000001' and reason = 'badge'),
    'a settled challenge with an unminted survivor needs the badge step';

  -- Non-survivors never get a badge.
  begin
    perform public.record_badge('fd000000-0000-0000-0000-000000000001', 'Ls5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'Mf111111111111111111111111111111111111111111', '2' || repeat('3', 86));
    raise exception 'NOT REJECTED: a failed player got a badge';
  exception when raise_exception then
    assert sqlerrm like '%did not survive%', sqlerrm;
  end;

  b := public.record_badge('fd000000-0000-0000-0000-000000000001', 'Wn5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'Mw111111111111111111111111111111111111111111', '4' || repeat('5', 86));
  assert b is not null;
  assert public.record_badge('fd000000-0000-0000-0000-000000000001', 'Wn5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'Mw111111111111111111111111111111111111111111', null) = b, 'idempotent';
  select count(*) into n from public.badges where challenge_id = 'fd000000-0000-0000-0000-000000000001';
  assert n = 1, format('one badge, got %s', n);
  assert (select count(*) from public.notifications where dedupe_key = 'badge:' || b) = 1, 'the winner is notified once';
  assert (select count(*) from public.audit_log where action = 'badge.minted' and entity_id = b::text) = 1, 'logged once';

  -- A second, different mint for the same badge is refused (the chain allows one).
  begin
    perform public.record_badge('fd000000-0000-0000-0000-000000000001', 'Wn5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'Mx111111111111111111111111111111111111111111', '6' || repeat('7', 86));
    raise exception 'NOT REJECTED: a second mint';
  exception when raise_exception then
    assert sqlerrm like '%already has mint%', sqlerrm;
  end;

  assert not exists (select 1 from public.verification_work(50) where challenge_id = 'fd000000-0000-0000-0000-000000000001'), 'nothing left once minted';

  assert public.badge_metadata('Pw111111111111111111111111111111111111111111') ->> 'username' = 'badge_winner';
  assert public.badge_metadata('Pw111111111111111111111111111111111111111111') ->> 'mint' = 'Mw111111111111111111111111111111111111111111';
  assert public.badge_metadata('Pf111111111111111111111111111111111111111111') is null, 'no metadata for a failed player';
end $$;

-- Retry backoff: a recent attempt hides the challenge for 10 minutes.
delete from public.badges where challenge_id = 'fd000000-0000-0000-0000-000000000001';
update public.challenges set badges_checked_at = now() where id = 'fd000000-0000-0000-0000-000000000001';
do $$ begin
  assert not exists (select 1 from public.verification_work(50) where challenge_id = 'fd000000-0000-0000-0000-000000000001'), 'backoff after an attempt';
end $$;
update public.challenges set badges_checked_at = now() - interval '11 minutes' where id = 'fd000000-0000-0000-0000-000000000001';
do $$ begin
  assert exists (select 1 from public.verification_work(50) where challenge_id = 'fd000000-0000-0000-0000-000000000001' and reason = 'badge'), 'retried after 10 minutes';
end $$;

set role authenticated;
do $$ begin
  perform public.record_badge('fd000000-0000-0000-0000-000000000001', 'x', 'y', null);
  raise exception 'NOT REJECTED: users can record badges';
exception when insufficient_privilege then null;
end $$;
reset role;
set role anon;
do $$ begin
  perform public.badge_metadata('Pw111111111111111111111111111111111111111111');
  raise exception 'NOT REJECTED: anon can call a SECURITY DEFINER function (the web route reads it server-side)';
exception when insufficient_privilege then null;
end $$;
reset role;

do $$ begin raise notice '99j_soulbound_badges_test: all passed'; end $$;
