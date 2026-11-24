-- Phase 29 tests: chain -> database reconciliation fixes drift, adds what is missing, and is idempotent.
\set QUIET on
set client_min_messages = notice;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000e1'), ('00000000-0000-0000-0000-0000000000e2'), ('00000000-0000-0000-0000-0000000000e9');
insert into public.wallets (profile_id, address, kind, verified_at) values
  ('00000000-0000-0000-0000-0000000000e1', 'Ea5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'phantom', now()),
  ('00000000-0000-0000-0000-0000000000e2', 'Eb5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'phantom', now()),
  ('00000000-0000-0000-0000-0000000000e9', 'Ez5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'phantom', now());

-- A challenge the app knows, with drifted counts and a member whose state lags the chain.
insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash, onchain_address, onchain_challenge_id, participant_count, total_stake, payouts_done_at) values
  ('f8000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e9', 'Drifted', 'public', 'sol', 'So11111111111111111111111111111111111111112', 10000000,
   now() - interval '3 hours', 600, 3, now() - interval '4 hours', 2, 10, 0, 0, 0, 600, 900, '{"providers":["github"]}', repeat('ab', 32),
   'D1111111111111111111111111111111111111111111', 801, 1, 10000000, now());
insert into public.memberships (id, challenge_id, profile_id, wallet_address, participant_address, deposited) values
  ('f8100000-0000-0000-0000-000000000001', 'f8000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e1',
   'Ea5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'Pa5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000);

-- Day 0 saved and marked on-chain, day 1 saved but not marked: the chain has day 1 but not day 0.
create temp table rc (day int, body text);
insert into rc values
  (0, '{"challenge":"D1111111111111111111111111111111111111111111","day":0,"engine":"codestreak-rules/1","member":"Ea5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa","verdict":"verified"}'),
  (1, '{"challenge":"D1111111111111111111111111111111111111111111","day":1,"engine":"codestreak-rules/1","member":"Ea5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa","verdict":"verified"}');
do $$
declare r record;
begin
  for r in select * from rc loop
    perform public.save_day_result('f8100000-0000-0000-0000-000000000001', r.day::smallint, 'verified',
      encode(sha256(convert_to(r.body, 'UTF8')), 'hex'), 'codestreak-rules/1', r.body, '[]', null);
  end loop;
  perform public.mark_day_recorded('f8100000-0000-0000-0000-000000000001', 0::smallint, '6' || repeat('7', 86));
end $$;

create temp table chain (j jsonb, parts jsonb);
insert into chain values (
  '{"onchain_address":"D1111111111111111111111111111111111111111111","onchain_challenge_id":"801","creator":"Ez5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa",
    "mint":"So11111111111111111111111111111111111111112","vault":"V1111111111111111111111111111111111111111111","token":"sol","visibility":"public",
    "buy_in":"10000000","start_at":"2026-01-01T00:00:00Z","day_length_secs":600,"num_days":3,"join_deadline_at":"2025-12-31T23:00:00Z",
    "min_participants":2,"max_participants":10,"shield_price":"0","max_shields":0,"shield_grace_secs":0,"verify_window_secs":600,"dispute_window_secs":900,
    "rules_hash":"abababababababababababababababababababababababababababababababab",
    "pool_state":"settled","participant_count":2,"total_stake":"20000000","total_sponsor":"5000000","total_shield":"0"}',
  '[{"address":"Pa5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa","wallet":"Ea5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa","deposited":"10000000",
     "status":"survived","finalized":true,"claimed":false,"joined_at":1767225600,"days":{"1":"failed","2":"verified"}},
    {"address":"Pb5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa","wallet":"Eb5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa","deposited":"10000000",
     "status":"failed","finalized":true,"claimed":false,"joined_at":1767225700,"days":{}},
    {"address":"Pc5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa","wallet":"Ec5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa","deposited":"10000000",
     "status":"voided","finalized":true,"claimed":false,"joined_at":1767225800,"days":{}}]');

do $$
declare r jsonb; again jsonb; ch public.challenges;
begin
  r := public.reconcile_challenge((select j from chain), (select parts from chain), true);
  select * into ch from public.challenges where id = 'f8000000-0000-0000-0000-000000000001';
  assert not (r ->> 'added')::boolean, 'existing challenge';
  assert ch.pool_state = 'settled' and ch.participant_count = 2 and ch.total_stake = 20000000 and ch.total_sponsor = 5000000, 'state and totals follow the chain';
  assert ch.payouts_done_at is null, 'payouts reopened while the chain still owes';
  assert (select details -> 'participant_count' ->> 'db' from public.audit_log where action = 'reconcile.challenge_fixed' and entity_id = ch.id::text) = '1',
    'the fix is logged with the database value';
  -- Member: status, finalized follow the chain.
  assert (select status from public.memberships where id = 'f8100000-0000-0000-0000-000000000001') = 'survived', 'member status';
  assert (select finalized_at is not null from public.memberships where id = 'f8100000-0000-0000-0000-000000000001'), 'member finalized';
  -- Joined outside the app with a linked wallet: added. Unlinked wallet: ignored.
  assert (select status from public.memberships where wallet_address = 'Eb5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa') = 'failed', 'outside join mirrored';
  assert not exists (select 1 from public.memberships where wallet_address = 'Ec5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa'), 'unlinked wallet not added';
  -- Days: day 0 is not on-chain any more (re-record), day 1 is.
  assert (select onchain_at is null and record_tx is null from public.day_results where membership_id = 'f8100000-0000-0000-0000-000000000001' and day = 0), 'day 0 cleared';
  assert (select onchain_at is not null from public.day_results where membership_id = 'f8100000-0000-0000-0000-000000000001' and day = 1), 'day 1 marked';
  assert (r -> 'warnings') @> '["day 2 of Ea5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa: database says verified, chain says failed"]', 'a different result is reported';
  assert (select result from public.day_results where membership_id = 'f8100000-0000-0000-0000-000000000001' and day = 1) = 'verified', 'never overwritten';

  -- Idempotent: the same chain state changes nothing and logs nothing new.
  again := public.reconcile_challenge((select j from chain), (select parts from chain), false);
  assert again -> 'changes' = '[]', format('no changes the second time: %s', again -> 'changes');
  assert (select count(*) from public.audit_log where action like 'reconcile.%') = 6, 'no new audit entries';
end $$;

-- A challenge created outside the app is added, attributed to the creator's profile.
do $$
declare r jsonb; j jsonb := (select j from chain);
begin
  j := j || '{"onchain_address":"N1111111111111111111111111111111111111111111","onchain_challenge_id":"802","vault":"W1111111111111111111111111111111111111111111","pool_state":"open"}';
  r := public.reconcile_challenge(j, '[]', false);
  assert (r ->> 'added')::boolean, 'added';
  assert (select creator_id = '00000000-0000-0000-0000-0000000000e9' and title = 'Demo challenge N111' and rules ->> 'source' = 'chain'
            from public.challenges where onchain_address = 'N1111111111111111111111111111111111111111111'), 'attributed and labelled';
  assert (public.reconcile_challenge(j, '[]', false) -> 'changes') = '[]', 'second pass changes nothing';
end $$;

-- Only the worker may call it.
set role authenticated;
do $$ begin
  perform public.reconcile_challenge('{}', '[]', false);
  raise exception 'NOT REJECTED: reconcile_challenge callable by users';
exception when insufficient_privilege then null;
end $$;
reset role;

do $$ begin raise notice '99e_reconcile_test: all passed'; end $$;
