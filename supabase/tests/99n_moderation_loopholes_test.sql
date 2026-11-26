-- Control Center review fixes: owner can clear reports about itself, blocked accounts can't report,
-- appeals have a cooldown.
\set QUIET on
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at, last_sign_in_at) values
  ('dd000000-0000-0000-0000-0000000000a1', 'n-owner@example.com', now(), now()),
  ('dd000000-0000-0000-0000-0000000000a2', 'n-ann@example.com', now(), now()),
  ('dd000000-0000-0000-0000-0000000000a3', 'n-cid@example.com', now(), now());
update public.profiles set username = 'dd_owner' where id = 'dd000000-0000-0000-0000-0000000000a1';
update public.profiles set username = 'dd_ann' where id = 'dd000000-0000-0000-0000-0000000000a2';
update public.profiles set username = 'dd_cid' where id = 'dd000000-0000-0000-0000-0000000000a3';
delete from public.admins;
insert into public.admins (profile_id) values ('dd000000-0000-0000-0000-0000000000a1');

-- An active user reports the owner; a second open report is refused.
set role authenticated;
set request.jwt.claim.sub = 'dd000000-0000-0000-0000-0000000000a2';
do $$ begin
  assert public.report_user('dd_owner', 'cheating', null) is not null;
end $$;
do $$ begin
  perform public.report_user('dd_owner', 'other', 'again');
  raise exception 'NOT REJECTED: duplicate open report';
exception when unique_violation then null;
end $$;
reset role;
reset request.jwt.claim.sub;

do $$
declare rid uuid := (select id from public.user_reports where reported_id = 'dd000000-0000-0000-0000-0000000000a1' and status = 'open');
begin
  -- The owner can dismiss a report about itself...
  perform public.admin_moderate('dd000000-0000-0000-0000-0000000000a1', 'dd000000-0000-0000-0000-0000000000a1', 'report_set', 'not cheating, checked',
    jsonb_build_object('report_id', rid, 'status', 'dismissed', 'resolution', 'checked'), gen_random_uuid());
  assert (select status from public.user_reports where id = rid) = 'dismissed';
  -- ...but still can't take account actions on itself.
  begin
    perform public.admin_moderate('dd000000-0000-0000-0000-0000000000a1', 'dd000000-0000-0000-0000-0000000000a1', 'warn', 'self warning', '{}', gen_random_uuid());
    raise exception 'NOT REJECTED: self warning';
  exception when invalid_parameter_value then null;
  end;
  -- Suspend cid for a day.
  perform public.admin_moderate('dd000000-0000-0000-0000-0000000000a1', 'dd000000-0000-0000-0000-0000000000a3', 'suspend', 'spamming reports',
    '{"hours": 24, "notify": false}', gen_random_uuid());
end $$;

-- A suspended account can't report, but can appeal once.
set role authenticated;
set request.jwt.claim.sub = 'dd000000-0000-0000-0000-0000000000a3';
do $$ begin
  perform public.report_user('dd_ann', 'harassment', 'payback');
  raise exception 'NOT REJECTED: report from a suspended account';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  assert public.submit_appeal('Please review my suspension.') is not null;
end $$;
reset role;
reset request.jwt.claim.sub;

do $$ begin
  perform public.admin_moderate('dd000000-0000-0000-0000-0000000000a1', 'dd000000-0000-0000-0000-0000000000a3', 'appeal_decide', 'decision stands',
    jsonb_build_object('appeal_id', (select id from public.moderation_appeals where profile_id = 'dd000000-0000-0000-0000-0000000000a3' and status = 'open'), 'accept', false, 'note', 'stands'),
    gen_random_uuid());
end $$;

-- Right after a decision, a new appeal waits a day.
set role authenticated;
set request.jwt.claim.sub = 'dd000000-0000-0000-0000-0000000000a3';
do $$ begin
  perform public.submit_appeal('Please look again, really.');
  raise exception 'NOT REJECTED: appeal right after a decision';
exception when program_limit_exceeded then null;
end $$;
reset role;
reset request.jwt.claim.sub;

do $$ begin raise notice '99n_moderation_loopholes_test: all passed'; end $$;
