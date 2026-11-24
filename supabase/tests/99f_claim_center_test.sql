-- Phase 30 tests: unwrap requests carry no challenge; every other request must name one.
\set QUIET on
set client_min_messages = notice;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000f1');
do $$
begin
  insert into public.relayer_requests (profile_id, idempotency_key, kind, challenge_address, wallet, message_hash, prepared_tx, last_valid_block_height)
  values ('00000000-0000-0000-0000-0000000000f1', gen_random_uuid(), 'unwrap', null, 'Fa5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', repeat('a', 64), 'AA==', 1);
  begin
    insert into public.relayer_requests (profile_id, idempotency_key, kind, challenge_address, wallet, message_hash, prepared_tx, last_valid_block_height)
    values ('00000000-0000-0000-0000-0000000000f1', gen_random_uuid(), 'claim', null, 'Fa5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', repeat('a', 64), 'AA==', 1);
    raise exception 'NOT REJECTED: a claim without a challenge';
  exception when check_violation then null;
  end;
  raise notice '99f_claim_center_test: all passed';
end $$;
