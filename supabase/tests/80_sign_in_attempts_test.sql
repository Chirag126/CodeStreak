-- Sign-in attempts: hashed emails only; invisible to users.
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

insert into public.sign_in_attempts (email_hash, kind) values (repeat('ab', 32), 'send');
select pg_temp.expect_fail('plain email stored', $q$ insert into public.sign_in_attempts (email_hash, kind) values ('friend@example.com', 'send') $q$);

set role authenticated;
select pg_temp.expect_fail('a user reads attempts', $q$ select count(*) from public.sign_in_attempts $q$);
reset role;
set role anon;
select pg_temp.expect_fail('anon writes attempts', $q$ insert into public.sign_in_attempts (email_hash, kind) values (repeat('cd', 32), 'send') $q$);
reset role;

\echo 'sign-in attempts: all tests passed'
