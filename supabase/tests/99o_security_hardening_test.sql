-- Phase 41.1: grants / RLS invariants that must hold for every future migration too.
\set QUIET on
set client_min_messages = warning;

do $$
declare bad text;
begin
  -- Every table in public has RLS on.
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  assert bad is null, 'tables without RLS: ' || bad;

  -- Every view in public runs with the caller's rights (security_invoker), so RLS applies through it.
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v' and not coalesce('security_invoker=true' = any(c.reloptions), false);
  assert bad is null, 'views without security_invoker: ' || bad;

  -- No SECURITY DEFINER function in the API schema is callable by anon or signed-in users.
  select string_agg(p.proname, ', ') into bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  assert bad is null, 'definer functions exposed to API roles: ' || bad;

  -- Every table with RLS has at least one policy (an explicit deny counts), so intent is written down.
  select string_agg(c.relname, ', ') into bad
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
    and not exists (select 1 from pg_policies pp where pp.schemaname = 'public' and pp.tablename = c.relname);
  assert bad is null, 'RLS tables without any policy: ' || bad;

  -- Service-role-only tables carry no grants for API roles.
  select string_agg(t, ', ') into bad
  from unnest(array['admin_audit', 'admin_notes', 'admins', 'moderation_flags', 'leetcode_binding_codes',
                    'leetcode_snapshots', 'linked_account_releases', 'sign_in_attempts', 'wallet_login_challenges']) t
  where has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select')
     or has_table_privilege('authenticated', 'public.' || t, 'insert');
  assert bad is null, 'service-role tables still granted: ' || bad;

  -- anon can't call the signed-in RPCs at all.
  assert not has_function_privilege('anon', 'public.report_user(text, public.report_reason, text)', 'execute');
  assert not has_function_privilege('anon', 'private.report_user(text, public.report_reason, text)', 'execute');
end $$;

-- The wrappers still work for a signed-in user, and still see who is calling.
insert into auth.users (id, email, email_confirmed_at, last_sign_in_at) values
  ('ee000000-0000-0000-0000-0000000000a1', 'o-a@example.com', now(), now());
set role authenticated;
set request.jwt.claim.sub = 'ee000000-0000-0000-0000-0000000000a1';
do $$ begin
  assert public.am_i_admin() = false;
  assert (public.my_account_status() ->> 'status') is not null;
  assert public.mark_notifications_read(null) >= 0;
  begin
    perform public.submit_appeal('nothing to appeal here');
    raise exception 'NOT REJECTED: appeal in good standing';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;
reset request.jwt.claim.sub;

-- Signed out: the service-role-only tables can't be read even by accident.
set role anon;
do $$ begin
  perform 1 from public.admins limit 1;
  raise exception 'NOT REJECTED: anon read admins';
exception when insufficient_privilege then null;
end $$;
reset role;

do $$ begin raise notice '99o_security_hardening_test: all passed'; end $$;
