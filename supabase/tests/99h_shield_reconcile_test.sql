-- Phase 32 tests: on-chain Shields missing in the database are added once; users can't call it.
\set QUIET on
set client_min_messages = notice;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000f7');
insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash, onchain_address, onchain_challenge_id, participant_count) values
  ('fb000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f7', 'Shields', 'public', 'sol', 'So11111111111111111111111111111111111111112', 10000000,
   now() - interval '5 minutes', 600, 3, now() - interval '6 minutes', 2, 10, 2000000, 2, 300, 600, 900, '{"providers":["github"]}', repeat('ab', 32),
   'Sh111111111111111111111111111111111111111111', 901, 1);
insert into public.memberships (id, challenge_id, profile_id, wallet_address, deposited) values
  ('fb100000-0000-0000-0000-000000000001', 'fb000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000f7', 'Ha5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000);
insert into public.shields (membership_id, day, price_paid, tx_signature) values ('fb100000-0000-0000-0000-000000000001', 0, 2000000, '9' || repeat('8', 86));

do $$
declare n integer;
begin
  n := public.reconcile_shields('Sh111111111111111111111111111111111111111111',
    '[{"wallet":"Ha5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa","days":[0,2]},{"wallet":"Unknown11111111111111111111111111111111111","days":[1]}]');
  assert n = 1, format('one missing Shield added, got %s', n);
  assert (select price_paid from public.shields where membership_id = 'fb100000-0000-0000-0000-000000000001' and day = 2) = 2000000, 'priced at the challenge Shield price';
  assert (select tx_signature is null from public.shields where day = 2 and membership_id = 'fb100000-0000-0000-0000-000000000001'), 'no transaction known';
  assert public.reconcile_shields('Sh111111111111111111111111111111111111111111', '[{"wallet":"Ha5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa","days":[0,2]}]') = 0, 'idempotent';
  assert (select count(*) from public.audit_log where action = 'reconcile.shield_added') = 1, 'logged once';
end $$;

set role authenticated;
do $$ begin
  perform public.reconcile_shields('x', '[]');
  raise exception 'NOT REJECTED: users can reconcile shields';
exception when insufficient_privilege then null;
end $$;
reset role;

do $$ begin raise notice '99h_shield_reconcile_test: all passed'; end $$;
