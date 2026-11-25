-- Phase 37.1 Developer Control Center: owner-only, atomic, idempotent, append-only hash-chained audit.
\set QUIET on
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at, last_sign_in_at) values
  ('cc000000-0000-0000-0000-0000000000a1', 'owner@example.com', now(), now()),
  ('cc000000-0000-0000-0000-0000000000a2', 'alice@example.com', now(), now()),
  ('cc000000-0000-0000-0000-0000000000a3', 'bob@example.com', null, null);
update public.profiles set username = 'cc_owner' where id = 'cc000000-0000-0000-0000-0000000000a1';
update public.profiles set username = 'cc_alice', display_name = 'Alice' where id = 'cc000000-0000-0000-0000-0000000000a2';
update public.profiles set username = 'cc_bob' where id = 'cc000000-0000-0000-0000-0000000000a3';
delete from public.admins;
insert into public.admins (profile_id) values ('cc000000-0000-0000-0000-0000000000a1');

do $$
declare res jsonb;
declare n bigint;
begin
  -- Exactly one owner.
  begin
    insert into public.admins (profile_id) values ('cc000000-0000-0000-0000-0000000000a2');
    raise exception 'NOT REJECTED: a second admin';
  exception when unique_violation then null;
  end;

  -- Anyone else is refused, before anything changes.
  begin
    perform public.admin_moderate('cc000000-0000-0000-0000-0000000000a2', 'cc000000-0000-0000-0000-0000000000a3', 'warn', 'testing it', '{}', gen_random_uuid());
    raise exception 'NOT REJECTED: non-owner moderated';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_list_users('cc000000-0000-0000-0000-0000000000a3', null, null, null, 10, 0);
    raise exception 'NOT REJECTED: non-owner listed users';
  exception when insufficient_privilege then null;
  end;

  -- Search by email, wallet-less user, status filter.
  -- Every owner read runs (the overview once failed on an ambiguous column at runtime only).
  res := public.admin_overview('cc000000-0000-0000-0000-0000000000a1');
  if (res->>'users')::int < 3 or jsonb_array_length(res->'series') <> 30 then raise exception 'overview wrong: %', res - 'series'; end if;
  if public.admin_auth_info('cc000000-0000-0000-0000-0000000000a1', 'cc000000-0000-0000-0000-0000000000a2')->>'email' <> 'alice@example.com' then raise exception 'auth info wrong'; end if;
  if not (public.admin_verify_audit_chain('cc000000-0000-0000-0000-0000000000a1')->>'ok')::boolean then raise exception 'empty chain should verify'; end if;
  res := public.admin_list_users('cc000000-0000-0000-0000-0000000000a1', 'alice@EXAMPLE', null, null, 10, 0);
  assert (res->>'total')::int = 1 and res->'rows'->0->>'username' = 'cc_alice', res::text;
  -- LIKE wildcards in the query are literal.
  res := public.admin_list_users('cc000000-0000-0000-0000-0000000000a1', '%', null, null, 10, 0);
  assert (res->>'total')::int = 0, 'a bare % must not match everything';

  -- Suspend: atomic, audited, notified, idempotent.
  res := public.admin_moderate('cc000000-0000-0000-0000-0000000000a1', 'cc000000-0000-0000-0000-0000000000a2', 'suspend', 'spamming invites',
                               '{"hours": 24, "public_reason": "Spam"}', 'aaaaaaaa-0000-0000-0000-000000000001');
  assert (res->'auth'->>'ban_hours')::int = 24, res::text;
  assert private.effective_status('cc000000-0000-0000-0000-0000000000a2') = 'suspended';
  assert not private.account_allows('cc000000-0000-0000-0000-0000000000a2', 'challenges'), 'suspended users cannot join';
  res := public.admin_moderate('cc000000-0000-0000-0000-0000000000a1', 'cc000000-0000-0000-0000-0000000000a2', 'suspend', 'spamming invites',
                               '{"hours": 24}', 'aaaaaaaa-0000-0000-0000-000000000001');
  assert (res->>'replay')::boolean, 'same request id is a replay';
  select count(*) into n from public.moderation_actions where profile_id = 'cc000000-0000-0000-0000-0000000000a2';
  assert n = 1, format('one action, got %s', n);
  select count(*) into n from public.admin_audit where target_profile = 'cc000000-0000-0000-0000-0000000000a2';
  assert n = 1, 'one audit entry';
  assert exists (select 1 from public.notifications where profile_id = 'cc000000-0000-0000-0000-0000000000a2' and kind = 'account'), 'user notified';

  -- An expired suspension is active again.
  update public.account_moderation set suspended_until = now() - interval '1 minute' where profile_id = 'cc000000-0000-0000-0000-0000000000a2';
  assert private.effective_status('cc000000-0000-0000-0000-0000000000a2') = 'active';

  -- A failing action changes nothing (atomic): invalid hours.
  begin
    perform public.admin_moderate('cc000000-0000-0000-0000-0000000000a1', 'cc000000-0000-0000-0000-0000000000a3', 'suspend', 'bad length', '{"hours": 0}', gen_random_uuid());
    raise exception 'NOT REJECTED: 0-hour suspension';
  exception when invalid_parameter_value then null;
  end;
  assert not exists (select 1 from public.account_moderation where profile_id = 'cc000000-0000-0000-0000-0000000000a3' and status <> 'active'), 'unchanged';
  assert not exists (select 1 from public.admin_audit where target_profile = 'cc000000-0000-0000-0000-0000000000a3'), 'nothing audited';

  -- Reason is mandatory; a ban needs the typed username.
  begin
    perform public.admin_moderate('cc000000-0000-0000-0000-0000000000a1', 'cc000000-0000-0000-0000-0000000000a3', 'warn', 'no', '{}', gen_random_uuid());
    raise exception 'NOT REJECTED: short reason';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_moderate('cc000000-0000-0000-0000-0000000000a1', 'cc000000-0000-0000-0000-0000000000a3', 'ban', 'cheating proven', '{"confirm": "someone_else"}', gen_random_uuid());
    raise exception 'NOT REJECTED: ban without confirmation';
  exception when invalid_parameter_value then null;
  end;
  res := public.admin_moderate('cc000000-0000-0000-0000-0000000000a1', 'cc000000-0000-0000-0000-0000000000a3', 'ban', 'cheating proven', '{"confirm": "CC_BOB"}', gen_random_uuid());
  assert private.effective_status('cc000000-0000-0000-0000-0000000000a3') = 'banned';

  -- The owner can't moderate itself.
  begin
    perform public.admin_moderate('cc000000-0000-0000-0000-0000000000a1', 'cc000000-0000-0000-0000-0000000000a1', 'ban', 'self ban test', '{"confirm": "cc_owner"}', gen_random_uuid());
    raise exception 'NOT REJECTED: self ban';
  exception when invalid_parameter_value then null;
  end;

  -- Username edit: unique and confirmed.
  begin
    perform public.admin_moderate('cc000000-0000-0000-0000-0000000000a1', 'cc000000-0000-0000-0000-0000000000a2', 'edit_profile', 'rename request', '{"username": "cc_bob", "confirm": "cc_alice"}', gen_random_uuid());
    raise exception 'NOT REJECTED: duplicate username';
  exception when unique_violation then null;
  end;
  perform public.admin_moderate('cc000000-0000-0000-0000-0000000000a1', 'cc000000-0000-0000-0000-0000000000a2', 'edit_profile', 'rename request', '{"username": "cc_alice2", "confirm": "cc_alice", "bio": "hi"}', gen_random_uuid());
  assert (select username from public.profiles where id = 'cc000000-0000-0000-0000-0000000000a2') = 'cc_alice2';

  -- Deletion needs its grace period to pass.
  perform public.admin_moderate('cc000000-0000-0000-0000-0000000000a1', 'cc000000-0000-0000-0000-0000000000a2', 'schedule_deletion', 'user asked to delete', '{"confirm": "cc_alice2", "days": 7}', gen_random_uuid());
  begin
    perform public.admin_moderate('cc000000-0000-0000-0000-0000000000a1', 'cc000000-0000-0000-0000-0000000000a2', 'finalize_deletion', 'user asked to delete', '{"confirm": "cc_alice2"}', gen_random_uuid());
    raise exception 'NOT REJECTED: early finalize';
  exception when invalid_parameter_value then null;
  end;

  -- The chain verifies.
  res := public.admin_verify_audit_chain('cc000000-0000-0000-0000-0000000000a1');
  assert (res->>'ok')::boolean and (res->>'entries')::int >= 4, res::text;
end $$;

-- Append-only: updates and deletes are refused, even with service-role-like privileges.
do $$ begin
  update public.admin_audit set reason = 'tampered' where id = (select min(id) from public.admin_audit);
  raise exception 'NOT REJECTED: audit update';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  delete from public.admin_audit;
  raise exception 'NOT REJECTED: audit delete';
exception when insufficient_privilege then null;
end $$;

-- Tampering (bypassing the trigger, as only a superuser could) is detected by the hash chain.
alter table public.admin_audit disable trigger admin_audit_no_update;
update public.admin_audit set reason = 'tampered' where id = (select min(id) from public.admin_audit);
alter table public.admin_audit enable trigger admin_audit_no_update;
do $$
declare res jsonb := public.admin_verify_audit_chain('cc000000-0000-0000-0000-0000000000a1');
begin
  assert not (res->>'ok')::boolean and (res->>'first_bad_id')::bigint = (select min(id) from public.admin_audit), res::text;
end $$;

-- Browsers can't call owner functions or write moderation state.
set role authenticated;
set request.jwt.claim.sub = 'cc000000-0000-0000-0000-0000000000a3';
do $$ begin
  perform public.admin_moderate('cc000000-0000-0000-0000-0000000000a1', 'cc000000-0000-0000-0000-0000000000a3', 'reinstate', 'let me back in', '{}', gen_random_uuid());
  raise exception 'NOT REJECTED: authenticated called admin_moderate';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update public.account_moderation set status = 'active' where profile_id = 'cc000000-0000-0000-0000-0000000000a3';
  assert not found, 'a user must not be able to change their own status';
end $$;
do $$ begin
  insert into public.account_moderation (profile_id) values ('cc000000-0000-0000-0000-0000000000a3');
  raise exception 'NOT REJECTED: user wrote moderation state';
exception when insufficient_privilege or unique_violation then null;
end $$;
do $$ begin
  perform reason from public.moderation_actions limit 1;
  raise exception 'NOT REJECTED: user read the internal reason';
exception when insufficient_privilege then null;
end $$;
do $$
declare st jsonb := public.my_account_status();
begin
  assert st->>'status' = 'banned', st::text;
  assert public.submit_appeal('I did not cheat, here is why.') is not null;
end $$;
do $$ begin
  perform public.submit_appeal('Second appeal while one is open.');
  raise exception 'NOT REJECTED: two open appeals';
exception when unique_violation then null;
end $$;
-- Reports: not yourself, one open per person.
do $$ begin
  perform public.report_user('cc_bob', 'spam', 'me');
  raise exception 'NOT REJECTED: self report';
exception when invalid_parameter_value then null;
end $$;
do $$ begin
  assert public.report_user('cc_owner', 'other', 'test report') is not null;
  perform public.report_user('cc_owner', 'other', 'again');
  raise exception 'NOT REJECTED: duplicate open report';
exception when unique_violation then null;
end $$;
reset role;
reset request.jwt.claim.sub;

do $$ begin raise notice '99l_control_center_test: all passed'; end $$;
