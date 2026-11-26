-- Review fixes for the Control Center (from the Phase 37 test videos):
--  * The owner can resolve (dismiss / action) reports filed against the owner account. Reports were the
--    only queue the owner couldn't clear, because every action on yourself was refused.
--  * Suspended, banned and departing accounts can't file reports.
--  * Appeals: one day between a decision and the next appeal, at most 5 in 30 days.
-- Bodies are copied from 20261125220000_control_center.sql with only those lines changed.

create or replace function public.admin_moderate(p_actor uuid, p_target uuid, p_action text, p_reason text, p_params jsonb, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare prior record;
declare before jsonb;
declare after jsonb;
declare m public.account_moderation;
declare p public.profiles;
declare auth_effect jsonb := 'null';
declare notify_title text;
declare notify_body text;
declare action_id bigint;
declare confirm_ok boolean;
declare val text;
declare r text;
begin
  perform private.assert_owner(p_actor);
  if p_request_id is null then raise exception 'request id required' using errcode = '22023'; end if;
  -- Idempotent: the same request is answered with its first result.
  select * into prior from public.moderation_actions where request_id = p_request_id;
  if found then
    if prior.profile_id <> p_target or prior.action <> p_action then raise exception 'request id reused for a different action' using errcode = '22023'; end if;
    return prior.result || jsonb_build_object('replay', true);
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'A reason of at least 5 characters is required.' using errcode = '22023'; end if;
  select * into p from public.profiles where id = p_target for update;
  if not found then raise exception 'No such user.' using errcode = 'P0002'; end if;
  if p_target = p_actor and p_action not in ('note_add', 'edit_profile', 'report_set') then
    raise exception 'The owner account can''t moderate itself.' using errcode = '22023';
  end if;
  p_params := coalesce(p_params, '{}');
  confirm_ok := lower(coalesce(p_params->>'confirm', '')) in (lower(coalesce(p.username, '')), lower(p.public_id)) and coalesce(p_params->>'confirm', '') <> '';

  insert into public.account_moderation (profile_id) values (p_target) on conflict (profile_id) do nothing;
  select * into m from public.account_moderation where profile_id = p_target for update;
  before := private.moderation_snapshot(p_target);
  if m.status = 'deleted' and p_action not in ('note_add', 'flag_add', 'flag_remove', 'report_set') then
    raise exception 'This account was deleted; only notes, flags and reports can change.' using errcode = '22023';
  end if;

  case p_action
  when 'warn' then
    update public.account_moderation set warnings = warnings + 1, updated_at = now() where profile_id = p_target;
    notify_title := 'Warning from CodeStreak'; notify_body := trim(p_reason);
  when 'suspend' then
    if coalesce((p_params->>'permanent')::boolean, false) then
      update public.account_moderation set status = 'suspended', suspended_until = null, public_reason = nullif(trim(p_params->>'public_reason'), ''), updated_at = now() where profile_id = p_target;
      auth_effect := jsonb_build_object('ban_hours', 876000);
    else
      if coalesce((p_params->>'hours')::int, 0) not between 1 and 8760 then raise exception 'Suspension length must be 1 to 8760 hours.' using errcode = '22023'; end if;
      update public.account_moderation set status = 'suspended', suspended_until = now() + make_interval(hours => (p_params->>'hours')::int),
             public_reason = nullif(trim(p_params->>'public_reason'), ''), updated_at = now() where profile_id = p_target;
      auth_effect := jsonb_build_object('ban_hours', (p_params->>'hours')::int);
    end if;
    notify_title := 'Your account is suspended'; notify_body := coalesce(nullif(trim(p_params->>'public_reason'), ''), 'See your account page for details and how to appeal.');
  when 'ban' then
    if not confirm_ok then raise exception 'Type the username to confirm a permanent ban.' using errcode = '22023'; end if;
    update public.account_moderation set status = 'banned', suspended_until = null, public_reason = nullif(trim(p_params->>'public_reason'), ''), updated_at = now() where profile_id = p_target;
    auth_effect := jsonb_build_object('ban_hours', 876000);
    notify_title := 'Your account is banned'; notify_body := coalesce(nullif(trim(p_params->>'public_reason'), ''), 'You can appeal from your account page.');
  when 'reinstate' then
    update public.account_moderation set status = 'active', suspended_until = null, public_reason = null, deletion_due_at = null, updated_at = now() where profile_id = p_target;
    auth_effect := jsonb_build_object('unban', true);
    notify_title := 'Your account is active again'; notify_body := 'Thanks for your patience.';
  when 'review' then
    update public.account_moderation set status = 'under_review', updated_at = now() where profile_id = p_target;
  when 'restrict' then
    for r in select jsonb_array_elements_text(coalesce(p_params->'add', '[]')) loop
      if r not in ('challenges', 'groups', 'sponsorship', 'profile_hidden') then raise exception 'Unknown restriction %', r using errcode = '22023'; end if;
      update public.account_moderation set restrictions = array_append(array_remove(restrictions, r::public.account_restriction), r::public.account_restriction) where profile_id = p_target;
    end loop;
    for r in select jsonb_array_elements_text(coalesce(p_params->'remove', '[]')) loop
      if r not in ('challenges', 'groups', 'sponsorship', 'profile_hidden', 'reverify') then raise exception 'Unknown restriction %', r using errcode = '22023'; end if;
      update public.account_moderation set restrictions = array_remove(restrictions, r::public.account_restriction) where profile_id = p_target;
    end loop;
    update public.account_moderation set public_reason = coalesce(nullif(trim(p_params->>'public_reason'), ''), public_reason), updated_at = now() where profile_id = p_target;
    notify_title := 'Some features on your account changed'; notify_body := coalesce(nullif(trim(p_params->>'public_reason'), ''), 'See your account page.');
  when 'require_reverify' then
    update public.account_moderation set restrictions = array_append(array_remove(restrictions, 'reverify'), 'reverify'), reverify_since = now(), updated_at = now() where profile_id = p_target;
    notify_title := 'Please re-link your coding accounts'; notify_body := 'Re-link GitHub / LeetCode in Settings to keep joining challenges.';
  when 'flag_add' then
    val := lower(trim(coalesce(p_params->>'flag', '')));
    if val !~ '^[a-z][a-z0-9_]{2,31}$' then raise exception 'Flags are lowercase words like "suspected_cheating".' using errcode = '22023'; end if;
    insert into public.moderation_flags (profile_id, flag, reason) values (p_target, val, trim(p_reason)) on conflict do nothing;
  when 'flag_remove' then
    update public.moderation_flags set removed_at = now(), removed_reason = trim(p_reason)
     where profile_id = p_target and flag = lower(trim(coalesce(p_params->>'flag', ''))) and removed_at is null;
    if not found then raise exception 'That flag is not set.' using errcode = 'P0002'; end if;
  when 'note_add' then
    if char_length(trim(coalesce(p_params->>'body', ''))) not between 1 and 2000 then raise exception 'A note is 1 to 2000 characters.' using errcode = '22023'; end if;
    insert into public.admin_notes (profile_id, body) values (p_target, trim(p_params->>'body'));
  when 'edit_profile' then
    if p_params ? 'username' then
      val := lower(trim(p_params->>'username'));
      if val !~ '^[a-z0-9_]{3,20}$' then raise exception 'Usernames are 3 to 20 lowercase letters, digits or _.' using errcode = '22023'; end if;
      if exists (select 1 from public.profiles x where x.username = val and x.id <> p_target) then raise exception 'That username is taken.' using errcode = '23505'; end if;
      if not confirm_ok then raise exception 'Type the current username to confirm a username change.' using errcode = '22023'; end if;
      update public.profiles set username = val where id = p_target;
    end if;
    if p_params ? 'display_name' then update public.profiles set display_name = nullif(trim(p_params->>'display_name'), '') where id = p_target; end if;
    if p_params ? 'bio' then update public.profiles set bio = nullif(trim(p_params->>'bio'), '') where id = p_target; end if;
    if p_params ? 'avatar_url' then
      val := nullif(trim(p_params->>'avatar_url'), '');
      if val is not null and val !~ '^https://[^\s]{4,500}$' then raise exception 'The picture must be an https:// URL.' using errcode = '22023'; end if;
      update public.profiles set avatar_url = val where id = p_target;
    end if;
    notify_title := 'Your profile was updated by CodeStreak'; notify_body := trim(p_reason);
  when 'schedule_deletion' then
    if not confirm_ok then raise exception 'Type the username to confirm scheduling a deletion.' using errcode = '22023'; end if;
    if coalesce((p_params->>'days')::int, 0) not between 1 and 30 then raise exception 'The grace period is 1 to 30 days.' using errcode = '22023'; end if;
    update public.account_moderation set status = 'pending_deletion', deletion_due_at = now() + make_interval(days => (p_params->>'days')::int), updated_at = now() where profile_id = p_target;
    notify_title := 'Your account is scheduled for deletion'; notify_body := 'You can appeal from your account page before it is deleted.';
  when 'cancel_deletion' then
    if m.status <> 'pending_deletion' then raise exception 'No deletion is scheduled.' using errcode = '22023'; end if;
    update public.account_moderation set status = 'active', deletion_due_at = null, updated_at = now() where profile_id = p_target;
    notify_title := 'Your account deletion was cancelled'; notify_body := 'Your account stays active.';
  when 'finalize_deletion' then
    if m.status <> 'pending_deletion' or m.deletion_due_at is null or m.deletion_due_at > now() then
      raise exception 'Deletion can be finalized only after its grace period ends.' using errcode = '22023';
    end if;
    if not confirm_ok then raise exception 'Type the username to confirm the deletion.' using errcode = '22023'; end if;
    -- Personal data goes; on-chain history and financial records stay (they are public and audited).
    update public.profiles set username = null, display_name = null, avatar_url = null, bio = null where id = p_target;
    delete from public.linked_accounts where profile_id = p_target;
    delete from public.wallets where profile_id = p_target;
    delete from public.notifications where profile_id = p_target;
    update public.account_moderation set status = 'deleted', restrictions = '{}', updated_at = now() where profile_id = p_target;
    auth_effect := jsonb_build_object('ban_hours', 876000, 'delete', true);
  when 'appeal_decide' then
    update public.moderation_appeals set status = case when (p_params->>'accept')::boolean then 'accepted'::public.appeal_status else 'rejected'::public.appeal_status end,
           decision_note = nullif(trim(p_params->>'note'), ''), decided_at = now()
     where id = (p_params->>'appeal_id')::uuid and profile_id = p_target and status = 'open';
    if not found then raise exception 'No open appeal with that id for this user.' using errcode = 'P0002'; end if;
    if (p_params->>'accept')::boolean then
      update public.account_moderation set status = 'active', suspended_until = null, public_reason = null, deletion_due_at = null,
             restrictions = array_remove(restrictions, 'reverify'), updated_at = now() where profile_id = p_target;
      auth_effect := jsonb_build_object('unban', true);
      notify_title := 'Your appeal was accepted'; notify_body := coalesce(nullif(trim(p_params->>'note'), ''), 'Your account is active again.');
    else
      notify_title := 'Your appeal was reviewed'; notify_body := coalesce(nullif(trim(p_params->>'note'), ''), 'The decision stands.');
    end if;
  when 'report_set' then
    if (p_params->>'status') not in ('reviewing', 'dismissed', 'actioned') then raise exception 'Report status must be reviewing, dismissed or actioned.' using errcode = '22023'; end if;
    update public.user_reports set status = (p_params->>'status')::public.report_status, resolution = nullif(trim(p_params->>'resolution'), ''),
           resolved_at = case when p_params->>'status' in ('dismissed', 'actioned') then now() else null end
     where id = (p_params->>'report_id')::uuid and reported_id = p_target;
    if not found then raise exception 'No such report for this user.' using errcode = 'P0002'; end if;
  else
    raise exception 'Unknown action %', p_action using errcode = '22023';
  end case;

  after := private.moderation_snapshot(p_target);
  insert into public.moderation_actions (request_id, profile_id, action, reason, params, before, after)
  values (p_request_id, p_target, p_action, trim(p_reason), p_params - 'confirm', before, after) returning id into action_id;
  perform private.admin_audit_append(p_actor, 'moderate.' || p_action, p_target, trim(p_reason), before, after, p_request_id);
  if notify_title is not null and coalesce((p_params->>'notify')::boolean, true) and (select status from public.account_moderation where profile_id = p_target) <> 'deleted' then
    perform private.notify(p_target, 'account', notify_title, left(notify_body, 300), '/dashboard/account', null, 'moderation:' || action_id);
  end if;
  update public.moderation_actions set result = jsonb_build_object('ok', true, 'replay', false, 'action_id', action_id, 'auth', auth_effect) where id = action_id;
  return jsonb_build_object('ok', true, 'replay', false, 'action_id', action_id, 'auth', auth_effect);
end $$;

create or replace function public.report_user(p_username text, p_reason public.report_reason, p_details text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
declare target uuid;
declare id uuid;
begin
  if me is null then raise exception 'Sign in to report someone.' using errcode = '42501'; end if;
  select p.id into target from public.profiles p where p.username = lower(trim(p_username));
  if target is null then raise exception 'No such user.' using errcode = 'P0002'; end if;
  if target = me then raise exception 'You can''t report yourself.' using errcode = '22023'; end if;
  -- Suspended, banned or departing accounts can't file reports (they could use them to harass whoever reported them).
  if private.effective_status(me) not in ('active', 'under_review') then
    raise exception 'Your account is suspended, so you can''t send reports right now. See Dashboard → Account.' using errcode = '42501';
  end if;
  if char_length(coalesce(p_details, '')) > 1000 then raise exception 'Details are limited to 1000 characters.' using errcode = '22023'; end if;
  if (select count(*) from public.user_reports r where r.reporter_id = me and r.created_at > now() - interval '1 day') >= 5 then
    raise exception 'You can send at most 5 reports a day.' using errcode = '54000';
  end if;
  if exists (select 1 from public.user_reports r where r.reporter_id = me and r.reported_id = target and r.status in ('open', 'reviewing')) then
    raise exception 'You already have an open report about this user.' using errcode = '23505';
  end if;
  insert into public.user_reports (reporter_id, reported_id, reason, details) values (me, target, p_reason, nullif(trim(p_details), '')) returning user_reports.id into id;
  return id;
end $$;

create or replace function public.submit_appeal(p_message text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
declare id uuid;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if private.effective_status(me) = 'active' and not exists (select 1 from public.account_moderation m where m.profile_id = me and cardinality(m.restrictions) > 0) then
    raise exception 'There is nothing to appeal: your account is in good standing.' using errcode = '22023';
  end if;
  if char_length(trim(coalesce(p_message, ''))) < 10 then raise exception 'Please explain in at least 10 characters.' using errcode = '22023'; end if;
  if exists (select 1 from public.moderation_appeals a where a.profile_id = me and a.status = 'open') then
    raise exception 'You already have an appeal under review.' using errcode = '23505';
  end if;
  -- No appeal spam: one day between a decision and the next appeal, and at most 5 appeals in 30 days.
  if exists (select 1 from public.moderation_appeals a where a.profile_id = me and a.status <> 'open' and a.decided_at > now() - interval '1 day') then
    raise exception 'Your last appeal was decided less than a day ago. You can appeal again after %.',
      to_char(((select max(a.decided_at) from public.moderation_appeals a where a.profile_id = me) + interval '1 day') at time zone 'UTC', 'YYYY-MM-DD HH24:MI "UTC"')
      using errcode = '54000';
  end if;
  if (select count(*) from public.moderation_appeals a where a.profile_id = me and a.created_at > now() - interval '30 days') >= 5 then
    raise exception 'You can send at most 5 appeals in 30 days.' using errcode = '54000';
  end if;
  insert into public.moderation_appeals (profile_id, message) values (me, trim(p_message)) returning moderation_appeals.id into id;
  return id;
end $$;
