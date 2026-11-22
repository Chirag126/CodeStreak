-- Phase 13 tests: wallet binding nonces and the one-wallet-one-profile rule.
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

insert into auth.users (id) values ('00000000-0000-0000-0000-000000000011'), ('00000000-0000-0000-0000-000000000012');

insert into public.wallet_nonces (id, profile_id, address, nonce, message, issued_at, expires_at) values
  ('c0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000011',
   'GgTKpyyDvzxwYvadYfjXbdJ7LQeW8LgBUnySsAULaWn2', repeat('ab', 16), 'msg', now(), now() + interval '5 minutes');

-- The server consumes a nonce with one conditional update: a replay finds nothing to update.
do $$
declare first_use int; second_use int;
begin
  update public.wallet_nonces set used_at = now() where id = 'c0000000-0000-0000-0000-000000000001' and used_at is null and expires_at > now();
  get diagnostics first_use = row_count;
  update public.wallet_nonces set used_at = now() where id = 'c0000000-0000-0000-0000-000000000001' and used_at is null and expires_at > now();
  get diagnostics second_use = row_count;
  assert first_use = 1 and second_use = 0, 'a nonce can be consumed only once';
end $$;

select pg_temp.expect_fail('0x address in a challenge', $q$
  insert into public.wallet_nonces (profile_id, address, nonce, message, expires_at)
  values ('00000000-0000-0000-0000-000000000011', '0x52908400098527886E0F7030069857D2E4169EE7', repeat('cd', 16), 'm', now() + interval '1 minute') $q$);
select pg_temp.expect_fail('nonce reused', $q$
  insert into public.wallet_nonces (profile_id, address, nonce, message, expires_at)
  values ('00000000-0000-0000-0000-000000000012', 'GgTKpyyDvzxwYvadYfjXbdJ7LQeW8LgBUnySsAULaWn2', repeat('ab', 16), 'm', now() + interval '1 minute') $q$);
select pg_temp.expect_fail('nonce valid for too long', $q$
  insert into public.wallet_nonces (profile_id, address, nonce, message, expires_at)
  values ('00000000-0000-0000-0000-000000000011', 'GgTKpyyDvzxwYvadYfjXbdJ7LQeW8LgBUnySsAULaWn2', repeat('ef', 16), 'm', now() + interval '1 hour') $q$);
select pg_temp.expect_fail('nonce not random hex', $q$
  insert into public.wallet_nonces (profile_id, address, nonce, message, expires_at)
  values ('00000000-0000-0000-0000-000000000011', 'GgTKpyyDvzxwYvadYfjXbdJ7LQeW8LgBUnySsAULaWn2', 'guessable', 'm', now() + interval '1 minute') $q$);

-- One wallet, two users: the second link is refused by the database.
insert into public.wallets (profile_id, address, kind, is_primary, verified_at)
  values ('00000000-0000-0000-0000-000000000011', 'GgTKpyyDvzxwYvadYfjXbdJ7LQeW8LgBUnySsAULaWn2', 'phantom', true, now());
select pg_temp.expect_fail('one wallet on two users', $q$
  insert into public.wallets (profile_id, address, kind, verified_at)
  values ('00000000-0000-0000-0000-000000000012', 'GgTKpyyDvzxwYvadYfjXbdJ7LQeW8LgBUnySsAULaWn2', 'metamask', now()) $q$);

-- Users can't create nonces or link wallets themselves, and see only their own nonces.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000012', false);
select pg_temp.expect_fail('user inserts a nonce directly', $q$
  insert into public.wallet_nonces (profile_id, address, nonce, message, expires_at)
  values ('00000000-0000-0000-0000-000000000012', 'GgTKpyyDvzxwYvadYfjXbdJ7LQeW8LgBUnySsAULaWn2', repeat('12', 16), 'm', now() + interval '1 minute') $q$);
select pg_temp.expect_fail('user links a wallet directly', $q$
  insert into public.wallets (profile_id, address, kind) values ('00000000-0000-0000-0000-000000000012', '4TYd5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JT', 'phantom') $q$);
do $$ begin assert (select count(*) from public.wallet_nonces) = 0, 'other users'' nonces are hidden'; end $$;
reset role;

\echo 'wallet: all nonce and binding tests passed'
