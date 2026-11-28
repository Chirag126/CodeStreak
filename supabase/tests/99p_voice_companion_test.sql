-- Phase 41.2: notification preferences, local-time deadline warnings, voice limits and kill switches.
\set QUIET on
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at, last_sign_in_at) values
  ('ff000000-0000-0000-0000-0000000000a1', 'v-owner@example.com', now(), now()),
  ('ff000000-0000-0000-0000-0000000000a2', 'v-ann@example.com', now(), now()),
  ('ff000000-0000-0000-0000-0000000000a3', 'v-ben@example.com', now(), now());
update public.profiles set username = 'vv_owner' where id = 'ff000000-0000-0000-0000-0000000000a1';
update public.profiles set username = 'vv_ann', timezone = 'Asia/Kolkata' where id = 'ff000000-0000-0000-0000-0000000000a2';
update public.profiles set username = 'vv_ben', timezone = 'Not/AZone' where id = 'ff000000-0000-0000-0000-0000000000a3';
delete from public.admins;
insert into public.admins (profile_id) values ('ff000000-0000-0000-0000-0000000000a1');

-- ---- preferences: defaults on, only your own row, unknown keys refused, account notices always delivered
set role authenticated;
set request.jwt.claim.sub = 'ff000000-0000-0000-0000-0000000000a3';
do $$
declare out_row jsonb;
begin
  out_row := public.set_notification_prefs('{"deadlines": false, "browser": true}');
  assert (out_row ->> 'deadlines')::boolean = false and (out_row ->> 'browser')::boolean = true and (out_row ->> 'rewards')::boolean = true, 'partial update';
  assert (select count(*) from public.notification_prefs) = 1, 'sees only own row';
  begin
    perform public.set_notification_prefs('{"admin": true}');
    raise exception 'NOT REJECTED: unknown key';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.set_notification_prefs('{"voice": "yes"}');
    raise exception 'NOT REJECTED: non-boolean';
  exception when invalid_parameter_value then null;
  end;
  begin
    update public.notification_prefs set rewards = false;
    raise exception 'NOT REJECTED: direct update';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
reset request.jwt.claim.sub;
set role anon;
do $$ begin
  perform public.set_notification_prefs('{"voice": false}');
  raise exception 'NOT REJECTED: anon prefs';
exception when insufficient_privilege then null;
end $$;
reset role;

do $$ begin
  assert private.notify('ff000000-0000-0000-0000-0000000000a3', 'deadline_warning', 'x', 'y', null, null, 'p-1') = false, 'muted category skipped';
  assert private.notify('ff000000-0000-0000-0000-0000000000a3', 'payout', 'x', 'y', null, null, 'p-2') = true, 'other categories delivered';
  assert private.notify('ff000000-0000-0000-0000-0000000000a3', 'account', 'x', 'y', null, null, 'p-3') = true, 'account notices always delivered';
  assert private.notify('ff000000-0000-0000-0000-0000000000a2', 'deadline_warning', 'x', 'y', null, null, 'p-4') = true, 'no prefs row = everything on';
end $$;

-- ---- deadline warnings in the player's time zone (Ann: IST; Ben: unknown zone -> UTC, but deadlines muted)
insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash, onchain_address, onchain_challenge_id, participant_count) values
  ('fd000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-0000000000a1', 'Voice group', 'public', 'sol', 'So11111111111111111111111111111111111111112', 10000000,
   now() - interval '1 hour', 86400, 3, now() - interval '2 hours', 2, 10, 2000000, 1, 300, 600, 900, '{"providers":["github"]}', repeat('cd', 32),
   'Vx111111111111111111111111111111111111111111', 991, 2);
insert into public.memberships (id, challenge_id, profile_id, wallet_address, deposited) values
  ('fd100000-0000-0000-0000-000000000001', 'fd000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-0000000000a2', 'Va5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000),
  ('fd100000-0000-0000-0000-000000000002', 'fd000000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-0000000000a3', 'Vb5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000);

do $$
declare s timestamptz := (select start_at from public.challenges where id = 'fd000000-0000-0000-0000-000000000001');
declare ends timestamptz := s + interval '1 day';
declare w text;
begin
  assert private.final_lead_secs(86400) = 1800 and private.final_lead_secs(600) = 60 and private.final_lead_secs(3600) = 300, 'final leads';
  -- 2 h before the end: early warning for Ann only (Ben muted deadlines), in IST.
  perform private.send_deadline_warnings(ends - interval '2 hours');
  select title into w from public.notifications where challenge_id = 'fd000000-0000-0000-0000-000000000001' and dedupe_key like 'deadline:%';
  assert w = 'Day 1 of Voice group ends at ' || to_char(ends at time zone 'Asia/Kolkata', 'HH24:MI') || ' IST', format('local time in title, got %s', w);
  assert (select count(*) from public.notifications where challenge_id = 'fd000000-0000-0000-0000-000000000001' and kind = 'deadline_warning') = 1, 'muted player skipped';
  -- 25 min before: one final warning; repeated runs add nothing.
  perform private.send_deadline_warnings(ends - interval '25 minutes');
  perform private.send_deadline_warnings(ends - interval '20 minutes');
  assert (select count(*) from public.notifications where challenge_id = 'fd000000-0000-0000-0000-000000000001' and dedupe_key like 'deadline-final:%') = 1, 'one final warning';
  assert (select title from public.notifications where challenge_id = 'fd000000-0000-0000-0000-000000000001' and dedupe_key like 'deadline-final:%')
         = 'Last call: day 1 of Voice group ends in 25 min', 'final title';
end $$;

-- Unknown time zone falls back to UTC (Ben turns deadlines back on).
set role authenticated;
set request.jwt.claim.sub = 'ff000000-0000-0000-0000-0000000000a3';
select public.set_notification_prefs('{"deadlines": true}');
reset role;
reset request.jwt.claim.sub;
do $$
declare ends timestamptz := (select start_at from public.challenges where id = 'fd000000-0000-0000-0000-000000000001') + interval '1 day';
begin
  perform private.send_deadline_warnings(ends - interval '2 hours');
  assert (select title from public.notifications where profile_id = 'ff000000-0000-0000-0000-0000000000a3' and dedupe_key like 'deadline:%')
         = 'Day 1 of Voice group ends at ' || to_char(ends at time zone 'UTC', 'HH24:MI') || ' UTC', 'UTC fallback';
end $$;

-- ---- voice: limits, kill switches, accounting
do $$
declare r jsonb;
declare ev bigint;
begin
  update public.voice_settings set enabled = true, announcements = true, monthly_char_limit = 1000, user_daily_limit = 2;
  r := public.voice_reserve('ff000000-0000-0000-0000-0000000000a2', 'briefing', 400);
  assert (r ->> 'ok')::boolean, 'first generation allowed';
  ev := (r ->> 'event')::bigint;
  perform public.voice_finish(ev, false, 120, 'ElevenLabs 503');
  -- A failed generation doesn't count; two successful ones hit the per-user daily limit.
  r := public.voice_reserve('ff000000-0000-0000-0000-0000000000a2', 'briefing', 300);
  perform public.voice_finish((r ->> 'event')::bigint, true, 900, null);
  r := public.voice_reserve('ff000000-0000-0000-0000-0000000000a2', 'announcement', 100);
  perform public.voice_finish((r ->> 'event')::bigint, true, 400, null);
  r := public.voice_reserve('ff000000-0000-0000-0000-0000000000a2', 'briefing', 10);
  assert r ->> 'reason' = 'daily_limit', format('daily limit, got %s', r);
  -- Another user hits the app-wide monthly limit (400 of 1000 left; 300 + 100 generated).
  r := public.voice_reserve('ff000000-0000-0000-0000-0000000000a3', 'briefing', 700);
  assert r ->> 'reason' = 'monthly_limit', format('monthly limit, got %s', r);
  -- Cache hits are logged and never counted.
  perform public.voice_log('ff000000-0000-0000-0000-0000000000a3', 'briefing', 'cached', 500, 30, null);
  r := public.voice_reserve('ff000000-0000-0000-0000-0000000000a3', 'briefing', 500);
  assert (r ->> 'ok')::boolean, format('cache hits not counted, got %s', r);
  -- Kill switches.
  update public.voice_settings set announcements = false;
  assert public.voice_reserve('ff000000-0000-0000-0000-0000000000a3', 'announcement', 10) ->> 'reason' = 'disabled', 'announcements off';
  update public.voice_settings set enabled = false;
  assert public.voice_reserve('ff000000-0000-0000-0000-0000000000a3', 'briefing', 10) ->> 'reason' = 'disabled', 'global kill switch';
  begin
    perform public.voice_reserve('ff000000-0000-0000-0000-0000000000a3', 'song', 10);
    raise exception 'NOT REJECTED: bad kind';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ---- owner controls: audited; anyone else refused
do $$
declare r jsonb;
begin
  r := public.admin_voice_settings_set('ff000000-0000-0000-0000-0000000000a1', true, true, 50000, 10);
  assert (r ->> 'monthly_char_limit')::integer = 50000 and (r ->> 'enabled')::boolean, 'owner updated settings';
  assert exists (select 1 from public.admin_audit where action = 'settings.voice'), 'audited';
  r := public.admin_voice_overview('ff000000-0000-0000-0000-0000000000a1');
  assert (r -> 'month' ->> 'generated')::integer >= 3 and (r -> 'month' ->> 'cached')::integer >= 1 and (r -> 'month' ->> 'errors')::integer >= 1, format('overview counts, got %s', r -> 'month');
  assert jsonb_array_length(r -> 'recent_errors') >= 1, 'recent errors listed';
  begin
    perform public.admin_voice_settings_set('ff000000-0000-0000-0000-0000000000a2', false, false, 0, 0);
    raise exception 'NOT REJECTED: non-owner';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_voice_settings_set('ff000000-0000-0000-0000-0000000000a1', true, true, -1, 10);
    raise exception 'NOT REJECTED: negative limit';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- ---- signed-in users can't reach the voice tables or functions
set role authenticated;
set request.jwt.claim.sub = 'ff000000-0000-0000-0000-0000000000a2';
do $$ begin
  perform 1 from public.voice_events limit 1;
  raise exception 'NOT REJECTED: read voice_events';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.voice_reserve('ff000000-0000-0000-0000-0000000000a2', 'briefing', 10);
  raise exception 'NOT REJECTED: user called voice_reserve';
exception when insufficient_privilege then null;
end $$;
reset role;
reset request.jwt.claim.sub;

update public.voice_settings set enabled = true, announcements = true, monthly_char_limit = 60000, user_daily_limit = 15;
do $$ begin raise notice '99p_voice_companion_test: all passed'; end $$;
