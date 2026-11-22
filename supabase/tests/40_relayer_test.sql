-- Phase 15 tests: relayer request idempotency and single submission.
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

insert into auth.users (id) values ('00000000-0000-0000-0000-000000000021'), ('00000000-0000-0000-0000-000000000022');
insert into public.relayer_requests (id, profile_id, idempotency_key, kind, challenge_address, wallet, message_hash, prepared_tx, last_valid_block_height)
values ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000021', 'e0000000-0000-0000-0000-000000000001', 'join',
        'Fm4RMrKKkJsPP4vDeCPkYgE4jiGQjzujStgz17Yhrhv2', 'GgTKpyyDvzxwYvadYfjXbdJ7LQeW8LgBUnySsAULaWn2', repeat('a', 64), 'AQ==', 100);

select pg_temp.expect_fail('same idempotency key twice for one user', $q$
  insert into public.relayer_requests (profile_id, idempotency_key, kind, challenge_address, wallet, message_hash, prepared_tx, last_valid_block_height)
  values ('00000000-0000-0000-0000-000000000021', 'e0000000-0000-0000-0000-000000000001', 'join',
          'Fm4RMrKKkJsPP4vDeCPkYgE4jiGQjzujStgz17Yhrhv2', 'GgTKpyyDvzxwYvadYfjXbdJ7LQeW8LgBUnySsAULaWn2', repeat('b', 64), 'AQ==', 100) $q$);
-- Another user may use the same key value.
insert into public.relayer_requests (profile_id, idempotency_key, kind, challenge_address, wallet, message_hash, prepared_tx, last_valid_block_height)
values ('00000000-0000-0000-0000-000000000022', 'e0000000-0000-0000-0000-000000000001', 'join',
        'Fm4RMrKKkJsPP4vDeCPkYgE4jiGQjzujStgz17Yhrhv2', '4TYd5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JT', repeat('c', 64), 'AQ==', 100);

-- Submission claims the row with one conditional update: a concurrent retry gets nothing.
do $$
declare a int; b int;
begin
  update public.relayer_requests set status = 'submitting' where id = 'd0000000-0000-0000-0000-000000000001' and status = 'prepared';
  get diagnostics a = row_count;
  update public.relayer_requests set status = 'submitting' where id = 'd0000000-0000-0000-0000-000000000001' and status = 'prepared';
  get diagnostics b = row_count;
  assert a = 1 and b = 0, 'a prepared transaction is submitted at most once';
end $$;

select pg_temp.expect_fail('confirmed without a signature', $q$
  update public.relayer_requests set status = 'confirmed' where id = 'd0000000-0000-0000-0000-000000000001' $q$);
select pg_temp.expect_fail('bad message hash', $q$
  update public.relayer_requests set message_hash = 'nope' where id = 'd0000000-0000-0000-0000-000000000001' $q$);

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000022', false);
do $$ begin assert (select count(*) from public.relayer_requests) = 1, 'users see only their own requests'; end $$;
-- No update policy: RLS hides every row from a user's UPDATE, so this changes nothing.
update public.relayer_requests set status = 'confirmed', signature = repeat('5', 87);
reset role;
do $$ begin assert (select count(*) from public.relayer_requests where status = 'confirmed') = 0, 'nothing confirmed by the user'; end $$;

\echo 'relayer: all idempotency tests passed'
