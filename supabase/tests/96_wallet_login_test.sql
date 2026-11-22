-- Wallet login challenges: server-only, single-use, short-lived.
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

insert into public.wallet_login_challenges (address, nonce, message, browser_hash, expires_at)
values ('Gg5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', repeat('ab', 16), 'x wants you to sign in', repeat('cd', 32), now() + interval '5 minutes');

select pg_temp.expect_fail('same nonce twice', $q$ insert into public.wallet_login_challenges (address, nonce, message, browser_hash, expires_at)
  values ('Gg5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', repeat('ab', 16), 'm', repeat('cd', 32), now() + interval '5 minutes') $q$);
select pg_temp.expect_fail('challenge living over 10 minutes', $q$ insert into public.wallet_login_challenges (address, nonce, message, browser_hash, expires_at)
  values ('Gg5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', repeat('ef', 16), 'm', repeat('cd', 32), now() + interval '1 hour') $q$);
select pg_temp.expect_fail('EVM address', $q$ insert into public.wallet_login_challenges (address, nonce, message, browser_hash, expires_at)
  values ('0x52908400098527886E0F7030069857D2E4169EE7', repeat('12', 16), 'm', repeat('cd', 32), now() + interval '5 minutes') $q$);
select pg_temp.expect_fail('raw browser cookie stored', $q$ insert into public.wallet_login_challenges (address, nonce, message, browser_hash, expires_at)
  values ('Gg5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', repeat('34', 16), 'm', 'cookie-value', now() + interval '5 minutes') $q$);

set role authenticated;
select pg_temp.expect_fail('a user reads challenges', $q$ select * from public.wallet_login_challenges $q$);
select pg_temp.expect_fail('a user marks a challenge unused', $q$ update public.wallet_login_challenges set used_at = null $q$);
reset role;
set role anon;
select pg_temp.expect_fail('a guest creates a challenge', $q$ insert into public.wallet_login_challenges (address, nonce, message, browser_hash, expires_at)
  values ('Gg5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', repeat('56', 16), 'm', repeat('cd', 32), now() + interval '5 minutes') $q$);
reset role;

\echo 'wallet login: all tests passed'
