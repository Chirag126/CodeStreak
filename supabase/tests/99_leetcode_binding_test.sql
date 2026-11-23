-- Phase 26 tests: LeetCode binding codes and handles.
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

insert into auth.users (id) values ('00000000-0000-0000-0000-000000000091'), ('00000000-0000-0000-0000-000000000092');

insert into public.leetcode_binding_codes (profile_id, handle, code, expires_at)
values ('00000000-0000-0000-0000-000000000091', 'Alice_99', 'CS-LC-7KQ2M9XAB3', now() + interval '15 minutes');

select pg_temp.expect_fail('second live code for one person', $q$ insert into public.leetcode_binding_codes (profile_id, handle, code, expires_at)
  values ('00000000-0000-0000-0000-000000000091', 'Alice_99', 'CS-LC-8KQ2M9XAB3', now() + interval '15 minutes') $q$);
select pg_temp.expect_fail('code living over 15 minutes', $q$ insert into public.leetcode_binding_codes (profile_id, handle, code, expires_at)
  values ('00000000-0000-0000-0000-000000000092', 'bob', 'CS-LC-9KQ2M9XAB3', now() + interval '1 hour') $q$);
select pg_temp.expect_fail('malformed code', $q$ insert into public.leetcode_binding_codes (profile_id, handle, code, expires_at)
  values ('00000000-0000-0000-0000-000000000092', 'bob', 'CS-LC-OOOOOOOOOO', now() + interval '5 minutes') $q$);
select pg_temp.expect_fail('handle with a slash', $q$ insert into public.leetcode_binding_codes (profile_id, handle, code, expires_at)
  values ('00000000-0000-0000-0000-000000000092', 'bob/x', 'CS-LC-AKQ2M9XAB3', now() + interval '5 minutes') $q$);
select pg_temp.expect_fail('more than 5 verify attempts', $q$ update public.leetcode_binding_codes set attempts = 6 where profile_id = '00000000-0000-0000-0000-000000000091' $q$);

-- A used code frees the slot for a new one.
update public.leetcode_binding_codes set used_at = now() where profile_id = '00000000-0000-0000-0000-000000000091';
insert into public.leetcode_binding_codes (profile_id, handle, code, expires_at)
values ('00000000-0000-0000-0000-000000000091', 'Alice_99', 'CS-LC-BKQ2M9XAB3', now() + interval '15 minutes');

-- Handles: lower-cased, unique across accounts.
insert into public.linked_accounts (profile_id, provider, provider_user_id, provider_username) values ('00000000-0000-0000-0000-000000000091', 'leetcode', 'alice_99', 'Alice_99');
select pg_temp.expect_fail('handle stored with capitals', $q$ insert into public.linked_accounts (profile_id, provider, provider_user_id, provider_username) values ('00000000-0000-0000-0000-000000000092', 'leetcode', 'Bob', 'Bob') $q$);
select pg_temp.expect_fail('same handle on a second account', $q$ insert into public.linked_accounts (profile_id, provider, provider_user_id, provider_username) values ('00000000-0000-0000-0000-000000000092', 'leetcode', 'alice_99', 'ALICE_99') $q$);

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000091', false);
select pg_temp.expect_fail('a user reads binding codes', $q$ select * from public.leetcode_binding_codes $q$);
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo 'leetcode binding: all tests passed'
