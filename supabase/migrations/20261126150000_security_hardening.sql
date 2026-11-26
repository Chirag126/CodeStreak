-- Phase 41.1: security hardening from the RLS / grants audit.
--
-- 1. The seven SECURITY DEFINER functions that signed-in users call through the API move into the
--    `private` schema (not exposed by the API). `public` keeps a SECURITY INVOKER wrapper with the same
--    name, arguments and result, so the app and PostgREST calls don't change. Each private function
--    keeps its own checks (auth.uid(), rate limits, account gates). Clears Supabase lint 0029.
--    When redefining one of these later, edit private.<name>, not the public wrapper.
-- 2. Tables only the service role touches had RLS on with no policy, and still carried the default
--    table grants for anon / authenticated. The grants are revoked and an explicit "no direct access"
--    policy documents the intent (clears lint 0008). The service role bypasses RLS, so nothing changes
--    for the app.

-- ---------------------------------------------------------------- 1. definer RPCs behind invoker wrappers
alter function public.am_i_admin() set schema private;
alter function public.mark_notifications_read(uuid[]) set schema private;
alter function public.my_account_status() set schema private;
alter function public.open_dispute(uuid, smallint, text, text[]) set schema private;
alter function public.report_user(text, public.report_reason, text) set schema private;
alter function public.review_dispute(uuid, boolean, text) set schema private;
alter function public.submit_appeal(text) set schema private;

revoke all on function private.am_i_admin() from public, anon;
revoke all on function private.mark_notifications_read(uuid[]) from public, anon;
revoke all on function private.my_account_status() from public, anon;
revoke all on function private.open_dispute(uuid, smallint, text, text[]) from public, anon;
revoke all on function private.report_user(text, public.report_reason, text) from public, anon;
revoke all on function private.review_dispute(uuid, boolean, text) from public, anon;
revoke all on function private.submit_appeal(text) from public, anon;
grant execute on function private.am_i_admin() to authenticated, service_role;
grant execute on function private.mark_notifications_read(uuid[]) to authenticated, service_role;
grant execute on function private.my_account_status() to authenticated, service_role;
grant execute on function private.open_dispute(uuid, smallint, text, text[]) to authenticated, service_role;
grant execute on function private.report_user(text, public.report_reason, text) to authenticated, service_role;
grant execute on function private.review_dispute(uuid, boolean, text) to authenticated, service_role;
grant execute on function private.submit_appeal(text) to authenticated, service_role;

create function public.am_i_admin() returns boolean
language sql stable security invoker set search_path = '' as $$ select private.am_i_admin() $$;

create function public.mark_notifications_read(p_ids uuid[] default null) returns integer
language sql volatile security invoker set search_path = '' as $$ select private.mark_notifications_read(p_ids) $$;

create function public.my_account_status() returns jsonb
language sql stable security invoker set search_path = '' as $$ select private.my_account_status() $$;

create function public.open_dispute(p_membership uuid, p_day smallint, p_reason text, p_evidence text[]) returns uuid
language sql volatile security invoker set search_path = '' as $$ select private.open_dispute(p_membership, p_day, p_reason, p_evidence) $$;

create function public.report_user(p_username text, p_reason public.report_reason, p_details text) returns uuid
language sql volatile security invoker set search_path = '' as $$ select private.report_user(p_username, p_reason, p_details) $$;

create function public.review_dispute(p_dispute uuid, p_approve boolean, p_note text) returns public.dispute_status
language sql volatile security invoker set search_path = '' as $$ select private.review_dispute(p_dispute, p_approve, p_note) $$;

create function public.submit_appeal(p_message text) returns uuid
language sql volatile security invoker set search_path = '' as $$ select private.submit_appeal(p_message) $$;

revoke all on function public.am_i_admin() from public, anon;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
revoke all on function public.my_account_status() from public, anon;
revoke all on function public.open_dispute(uuid, smallint, text, text[]) from public, anon;
revoke all on function public.report_user(text, public.report_reason, text) from public, anon;
revoke all on function public.review_dispute(uuid, boolean, text) from public, anon;
revoke all on function public.submit_appeal(text) from public, anon;
grant execute on function public.am_i_admin() to authenticated, service_role;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated, service_role;
grant execute on function public.my_account_status() to authenticated, service_role;
grant execute on function public.open_dispute(uuid, smallint, text, text[]) to authenticated, service_role;
grant execute on function public.report_user(text, public.report_reason, text) to authenticated, service_role;
grant execute on function public.review_dispute(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.submit_appeal(text) to authenticated, service_role;

-- ---------------------------------------------------------------- 2. service-role-only tables
do $$
declare t text;
begin
  foreach t in array array['admin_audit', 'admin_notes', 'admins', 'moderation_flags', 'leetcode_binding_codes',
                           'leetcode_snapshots', 'linked_account_releases', 'sign_in_attempts', 'wallet_login_challenges']
  loop
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('drop policy if exists "no direct access" on public.%I', t);
    execute format('create policy "no direct access" on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t);
  end loop;
end $$;

