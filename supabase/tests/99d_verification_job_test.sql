-- Phase 28 tests: work selection, the run lease, cached day results and idempotent recording.
\set QUIET on
set client_min_messages = notice;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000d1'), ('00000000-0000-0000-0000-0000000000d2'), ('00000000-0000-0000-0000-0000000000d9');
-- R: 3 x 10-min demo days, started 25 min ago (days 0 and 1 over), 2 players.
-- U: joining closed with 1 of 2 players.  S: everything over (settle).
insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash, onchain_address, onchain_challenge_id, participant_count) values
  ('f7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d9', 'Record run', 'private', 'sol', 'So11111111111111111111111111111111111111112', 10000000,
   now() - interval '25 minutes', 600, 3, now() - interval '26 minutes', 2, 10, 0, 0, 0, 600, 900, '{"providers":["github"]}', repeat('ab', 32),
   'R1111111111111111111111111111111111111111111', 901, 2),
  ('f7000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000d9', 'Underfilled', 'public', 'sol', 'So11111111111111111111111111111111111111112', 10000000,
   now() + interval '5 minutes', 600, 3, now() - interval '1 minute', 2, 10, 0, 0, 0, 600, 900, '{"providers":["github"]}', repeat('ac', 32),
   'U1111111111111111111111111111111111111111111', 902, 1),
  ('f7000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000d9', 'Settle run', 'public', 'usdc', '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 1000000,
   now() - interval '3 hours', 600, 3, now() - interval '4 hours', 2, 10, 0, 0, 0, 600, 900, '{"providers":["github"]}', repeat('ad', 32),
   'S1111111111111111111111111111111111111111111', 903, 2);
insert into public.memberships (id, challenge_id, profile_id, wallet_address, deposited) values
  ('f7100000-0000-0000-0000-000000000001', 'f7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d1', 'Mm5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000),
  ('f7100000-0000-0000-0000-000000000002', 'f7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000d2', 'Nn5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000);

do $$
begin
  assert private.record_delay_secs(600, 100000) = 150, 'a quarter of a 10-minute day';
  assert private.record_delay_secs(86400, 100000) = 2700, 'capped at 45 minutes';
  assert private.record_delay_secs(120, 100000) = 60, 'at least a minute';
  assert private.record_delay_secs(86400, 600) = 480, 'never past the verification window (2 min margin)';
  assert private.record_delay_secs(86400, 60) = 0, 'record at once when the window is nearly closed';
end $$;

do $$ begin
  assert (select array_agg(reason order by reason) from public.verification_work() where address like '_1111%') = array['cancel', 'record', 'settle'],
    'cancel, record and settle work is found';
  assert public.verification_has_work(), 'has work';
end $$;

-- The lease: one scheduled run per challenge; a second begin gets nothing; finishing frees it.
do $$
declare a uuid; b uuid; c uuid;
begin
  a := public.begin_verification_run('f7000000-0000-0000-0000-000000000001', 1::smallint);
  b := public.begin_verification_run('f7000000-0000-0000-0000-000000000001', 1::smallint);
  assert a is not null and b is null, 'a second run cannot take the lease';
  perform public.finish_verification_run(a, 'succeeded', 2, null);
  c := public.begin_verification_run('f7000000-0000-0000-0000-000000000001', 1::smallint);
  assert c is not null, 'the lease is free again after finishing';
  perform public.finish_verification_run(c, 'succeeded', 0, null);
  -- a run that died long ago doesn't block forever
  update public.verification_runs set started_at = now() - interval '11 minutes' where id = c;
end $$;
do $$
declare d uuid; e uuid;
begin
  d := public.begin_verification_run('f7000000-0000-0000-0000-000000000003', 0::smallint);
  update public.verification_runs set started_at = now() - interval '11 minutes' where id = d;
  e := public.begin_verification_run('f7000000-0000-0000-0000-000000000003', 0::smallint);
  assert e is not null, 'an expired lease is taken over';
  assert (select status from public.verification_runs where id = d) = 'failed', 'the expired run is marked failed';
end $$;

-- Saving: first save stores result + receipt + evidence; a second save returns the cached one.
create temp table rc (body text);
insert into rc values ('{"challenge":"R1111111111111111111111111111111111111111111","day":0,"engine":"codestreak-rules/1","member":"Mm5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa","verdict":"verified"}');
do $$
declare body text := (select body from rc); h text; first record; second record;
begin
  h := encode(sha256(convert_to(body, 'UTF8')), 'hex');
  select * into first from public.save_day_result('f7100000-0000-0000-0000-000000000001', 0::smallint, 'verified', h, 'codestreak-rules/1', body,
    '[{"provider":"github","kind":"commit","external_id":"aaa111","counted":true,"reason":"Counted.","details":{"lines":20}}]', null);
  assert first.cached = false and first.result = 'verified', 'first save stores';
  select * into second from public.save_day_result('f7100000-0000-0000-0000-000000000001', 0::smallint, 'failed', repeat('0', 64), 'codestreak-rules/1', body, '[]', null);
  assert second.cached = true and second.result = 'verified' and second.evidence_hash = h, 'a retry gets the stored result and hash, never a new one';
  assert (select count(*) from public.evidence where membership_id = 'f7100000-0000-0000-0000-000000000001' and day = 0) = 1, 'evidence stored once';
  assert (select count(*) from public.day_receipts where membership_id = 'f7100000-0000-0000-0000-000000000001') = 1, 'receipt stored';

  perform public.mark_day_recorded('f7100000-0000-0000-0000-000000000001', 0::smallint, '5' || repeat('1', 86));
  perform public.mark_day_recorded('f7100000-0000-0000-0000-000000000001', 0::smallint, '6' || repeat('1', 86));
  assert (select record_tx from public.day_results where membership_id = 'f7100000-0000-0000-0000-000000000001' and day = 0) = '5' || repeat('1', 86),
    'the first recorded transaction is kept';
  assert (select count(*) from public.audit_log where action = 'verification.day_recorded' and entity_id = 'f7100000-0000-0000-0000-000000000001') = 1, 'recorded once in the audit log';
  assert (select onchain_at is not null from public.day_results where membership_id = 'f7100000-0000-0000-0000-000000000001' and day = 0), 'marked on-chain';
end $$;

-- Payout work appears once a challenge is settled, and disappears when payouts are done.
update public.challenges set pool_state = 'settled' where id = 'f7000000-0000-0000-0000-000000000003';
do $$ begin
  assert (select reason from public.verification_work() where address like 'S1111%') = 'payout', 'payout work after settling';
end $$;
update public.challenges set payouts_done_at = now() where id = 'f7000000-0000-0000-0000-000000000003';
do $$ begin
  assert not exists (select 1 from public.verification_work() where address like 'S1111%'), 'no work after payouts';
end $$;

-- Mirroring the settlement and the payouts (idempotent).
do $$ begin
  perform public.mirror_pool_state('f7000000-0000-0000-0000-000000000001', 'settled',
    '[{"wallet":"Mm5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa","status":"survived"},{"wallet":"Nn5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa","status":"failed"}]');
  perform public.mirror_pool_state('f7000000-0000-0000-0000-000000000001', 'settled', '[]');
  assert (select pool_state from public.challenges where id = 'f7000000-0000-0000-0000-000000000001') = 'settled', 'pool settled';
  assert (select count(*) from public.audit_log where action = 'challenge.settled' and entity_id = 'f7000000-0000-0000-0000-000000000001') = 1, 'settled logged once';
  assert (select status from public.memberships where id = 'f7100000-0000-0000-0000-000000000002') = 'failed', 'outcome mirrored';
  assert (select finalized_at is not null from public.memberships where id = 'f7100000-0000-0000-0000-000000000001'), 'finalized_at set';

  perform public.record_payout('f7000000-0000-0000-0000-000000000001', 'Mm5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'reward', 20000000, '4' || repeat('2', 86));
  perform public.record_payout('f7000000-0000-0000-0000-000000000001', 'Mm5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'reward', 20000000, '4' || repeat('2', 86));
  assert (select count(*) from public.receipts where tx_signature = '4' || repeat('2', 86)) = 1, 'one receipt per transaction';
  assert (select payout from public.memberships where id = 'f7100000-0000-0000-0000-000000000001') = 20000000, 'payout mirrored';
  assert (select count(*) from public.audit_log where action = 'payout.reward') = 1, 'payout logged once';
  begin
    perform public.record_payout('f7000000-0000-0000-0000-000000000001', 'Mm5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'join', 1, '4' || repeat('3', 86));
    raise exception 'NOT REJECTED: a join recorded as a payout';
  exception when invalid_parameter_value then null;
  end;
end $$;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
do $$ begin
  begin
    perform public.verification_work();
    raise exception 'NOT REJECTED: a user lists verification work';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_day_result('f7100000-0000-0000-0000-000000000002', 0::smallint, 'verified', repeat('1', 64), 'x', '{}', '[]', null);
    raise exception 'NOT REJECTED: a user saves a day result';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo 'verification job: all tests passed'
