-- Phase 37.1: Developer Control Center (single owner, no roles).
--
-- Security model
--   * Exactly ONE owner: public.admins may hold at most one row (unique index on a constant). There
--     is no role column, no role table, no way to add a second admin from the app.
--   * Every admin read/write function here takes the acting profile id and refuses anyone but that
--     owner (private.assert_owner). They are executable by service_role ONLY: the web server calls
--     them after verifying the session against the owner identity in its own environment. Browsers
--     (anon / authenticated) can't call them at all.
--   * Users can read their own moderation status and submit appeals / reports through narrow SECURITY
--     DEFINER functions. They can't write their status, flags, notes or actions (no write policies).
--   * public.admin_audit is append-only (UPDATE / DELETE / TRUNCATE refused by trigger and grants) and
--     hash-chained: hash = sha256(prev_hash || canonical row). admin_verify_audit_chain() recomputes it.
--   * Each admin action is ONE function call = one transaction: it validates, applies, writes the
--     moderation history, the audit entry and the notification, or changes nothing at all.
--   * request_id makes every action idempotent (a double click or a retry is answered, not repeated).

-- ---------------------------------------------------------------- single owner
create unique index if not exists admins_single_owner on public.admins ((true));

create or replace function private.assert_owner(p_actor uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_actor is null or not exists (select 1 from public.admins a where a.profile_id = p_actor) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
end $$;
revoke all on function private.assert_owner(uuid) from public;

-- ---------------------------------------------------------------- profile fields the owner may edit
alter table public.profiles add column if not exists bio text check (char_length(bio) <= 280);

-- ---------------------------------------------------------------- account moderation state
create type public.account_status as enum ('active', 'under_review', 'suspended', 'banned', 'pending_deletion', 'deleted');
create type public.account_restriction as enum ('challenges', 'groups', 'sponsorship', 'profile_hidden', 'reverify');

create table public.account_moderation (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  status public.account_status not null default 'active',
  -- null = permanent (for suspended); ignored for other statuses.
  suspended_until timestamptz,
  restrictions public.account_restriction[] not null default '{}',
  -- Shown to the user (why they are restricted); internal notes live elsewhere.
  public_reason text check (char_length(public_reason) <= 500),
  deletion_due_at timestamptz,
  warnings integer not null default 0 check (warnings >= 0),
  reverify_since timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.account_moderation enable row level security;
create policy "users read their own moderation status" on public.account_moderation for select to authenticated
  using (profile_id = (select auth.uid()));

/** The status that applies right now (an expired suspension is active again). */
create or replace function private.effective_status(p_profile uuid) returns public.account_status
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case when m.status = 'suspended' and m.suspended_until is not null and m.suspended_until <= now() then 'active'::public.account_status else m.status end
      from public.account_moderation m where m.profile_id = p_profile
  ), 'active');
$$;
revoke all on function private.effective_status(uuid) from public;

/** May this profile use a feature right now? ('challenges' | 'groups' | 'sponsorship'). */
create or replace function private.account_allows(p_profile uuid, p_feature public.account_restriction) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.effective_status(p_profile) in ('active', 'under_review')
     and not exists (select 1 from public.account_moderation m where m.profile_id = p_profile
                       and (p_feature = any (m.restrictions)
                            -- re-verification pending blocks new participation until accounts are re-linked
                            or (p_feature in ('challenges', 'groups', 'sponsorship') and 'reverify' = any (m.restrictions))));
$$;
revoke all on function private.account_allows(uuid, public.account_restriction) from public;
grant execute on function private.account_allows(uuid, public.account_restriction) to service_role;

/** For the web server (service role): the gate the relayer checks before preparing any transaction. */
create or replace function public.account_gate(p_profile uuid, p_feature public.account_restriction) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'allowed', private.account_allows(p_profile, p_feature),
    'status', private.effective_status(p_profile),
    'reason', (select public_reason from public.account_moderation where profile_id = p_profile)
  );
$$;
revoke all on function public.account_gate(uuid, public.account_restriction) from public, anon, authenticated;
grant execute on function public.account_gate(uuid, public.account_restriction) to service_role;

-- Re-linking a coding account clears a pending re-verification.
create or replace function private.clear_reverify() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.account_moderation
     set restrictions = array_remove(restrictions, 'reverify'), reverify_since = null, updated_at = now()
   where profile_id = new.profile_id and 'reverify' = any (restrictions) and new.linked_at > coalesce(reverify_since, '-infinity');
  return null;
end $$;
revoke all on function private.clear_reverify() from public;
create trigger linked_accounts_clear_reverify after insert or update of linked_at on public.linked_accounts
  for each row execute function private.clear_reverify();

-- Restricted accounts can't send group invitations (database-level, whatever the client does).
create or replace function private.invitation_gate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.account_allows(new.invited_by, 'groups') then
    raise exception 'Your account is restricted from inviting people to groups.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.invitation_gate() from public;
create trigger invitations_account_gate before insert on public.invitations for each row execute function private.invitation_gate();

-- ---------------------------------------------------------------- flags, notes, history
create table public.moderation_flags (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  flag text not null check (flag ~ '^[a-z][a-z0-9_]{2,31}$'),
  reason text not null check (char_length(reason) between 5 and 500),
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_reason text check (char_length(removed_reason) <= 500)
);
create unique index moderation_flags_one_active on public.moderation_flags (profile_id, flag) where removed_at is null;
alter table public.moderation_flags enable row level security; -- no policies: owner functions only

create table public.admin_notes (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.admin_notes enable row level security; -- no policies

create table public.moderation_actions (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  action text not null check (action ~ '^[a-z][a-z_]{2,31}$'),
  reason text not null check (char_length(reason) between 5 and 500),
  params jsonb not null default '{}',
  before jsonb not null default '{}',
  after jsonb not null default '{}',
  result jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index moderation_actions_profile on public.moderation_actions (profile_id, created_at desc);
alter table public.moderation_actions enable row level security;
-- The user may see the actions taken on their own account (not the internal params).
create policy "users read actions on their account" on public.moderation_actions for select to authenticated
  using (profile_id = (select auth.uid()));
-- Column-level access: the user sees WHAT happened and WHEN, never the internal reason or values
-- (a column REVOKE can't narrow a table GRANT, so the table grant is replaced by column grants).
revoke all on public.moderation_actions from anon, authenticated;
grant select (id, profile_id, action, created_at) on public.moderation_actions to authenticated;

-- ---------------------------------------------------------------- reports and appeals
create type public.report_status as enum ('open', 'reviewing', 'dismissed', 'actioned');
create type public.report_reason as enum ('cheating', 'harassment', 'spam', 'impersonation', 'inappropriate', 'other');
create type public.report_target as enum ('profile', 'challenge', 'message'); -- 'message' reserved for future chats

create table public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  reported_id uuid not null references public.profiles (id) on delete cascade,
  target_type public.report_target not null default 'profile',
  target_ref text check (char_length(target_ref) <= 128),
  reason public.report_reason not null,
  details text check (char_length(details) <= 1000),
  status public.report_status not null default 'open',
  resolution text check (char_length(resolution) <= 500),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (reporter_id is null or reporter_id <> reported_id)
);
create unique index user_reports_one_open on public.user_reports (reporter_id, reported_id) where status in ('open', 'reviewing');
alter table public.user_reports enable row level security;
create policy "reporters read their own reports" on public.user_reports for select to authenticated using (reporter_id = (select auth.uid()));

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
revoke all on function public.report_user(text, public.report_reason, text) from public, anon;
grant execute on function public.report_user(text, public.report_reason, text) to authenticated;

create type public.appeal_status as enum ('open', 'accepted', 'rejected');
create table public.moderation_appeals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  message text not null check (char_length(message) between 10 and 2000),
  status public.appeal_status not null default 'open',
  decision_note text check (char_length(decision_note) <= 500),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index moderation_appeals_one_open on public.moderation_appeals (profile_id) where status = 'open';
alter table public.moderation_appeals enable row level security;
create policy "users read their own appeals" on public.moderation_appeals for select to authenticated using (profile_id = (select auth.uid()));

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
  insert into public.moderation_appeals (profile_id, message) values (me, trim(p_message)) returning moderation_appeals.id into id;
  return id;
end $$;
revoke all on function public.submit_appeal(text) from public, anon;
grant execute on function public.submit_appeal(text) to authenticated;
/** For the signed-in user: my own status (to show the account page / banners). */
create or replace function public.my_account_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', private.effective_status((select auth.uid())),
    'suspended_until', m.suspended_until,
    'restrictions', coalesce(m.restrictions, '{}'),
    'reason', m.public_reason,
    'deletion_due_at', m.deletion_due_at,
    'open_appeal', exists (select 1 from public.moderation_appeals a where a.profile_id = (select auth.uid()) and a.status = 'open')
  )
  from (select 1) one left join public.account_moderation m on m.profile_id = (select auth.uid());
$$;

grant execute on function public.my_account_status() to authenticated;
revoke all on function public.my_account_status() from public, anon;

-- ---------------------------------------------------------------- append-only, hash-chained audit
create table public.admin_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id uuid not null,
  action text not null check (action ~ '^[a-z][a-z0-9_.]{2,63}$'),
  target_profile uuid,
  reason text check (char_length(reason) <= 500),
  before jsonb not null default '{}',
  after jsonb not null default '{}',
  request_id uuid unique,
  prev_hash text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  hash text not null unique check (hash ~ '^[0-9a-f]{64}$')
);
alter table public.admin_audit enable row level security; -- no policies: owner functions only
revoke update, delete, truncate on public.admin_audit from public, anon, authenticated, service_role;

create or replace function private.audit_row_hash(p_prev text, p_at timestamptz, p_actor uuid, p_action text, p_target uuid, p_reason text, p_before jsonb, p_after jsonb, p_request uuid)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(
    p_prev || '|' || to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' || p_actor::text || '|' || p_action || '|' ||
    coalesce(p_target::text, '') || '|' || coalesce(p_reason, '') || '|' || p_before::text || '|' || p_after::text || '|' || coalesce(p_request::text, ''),
    'UTF8')), 'hex');
$$;
revoke all on function private.audit_row_hash(text, timestamptz, uuid, text, uuid, text, jsonb, jsonb, uuid) from public;

create or replace function private.admin_audit_append(p_actor uuid, p_action text, p_target uuid, p_reason text, p_before jsonb, p_after jsonb, p_request uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare prev text;
declare ts timestamptz := now();
declare new_id bigint;
begin
  -- Serialise appends so the chain has exactly one head.
  perform pg_advisory_xact_lock(hashtext('codestreak.admin_audit'));
  select a.hash into prev from public.admin_audit a order by a.id desc limit 1;
  prev := coalesce(prev, repeat('0', 64));
  insert into public.admin_audit (at, actor_id, action, target_profile, reason, before, after, request_id, prev_hash, hash)
  values (ts, p_actor, p_action, p_target, p_reason, coalesce(p_before, '{}'), coalesce(p_after, '{}'), p_request, prev,
          private.audit_row_hash(prev, ts, p_actor, p_action, p_target, p_reason, coalesce(p_before, '{}'), coalesce(p_after, '{}'), p_request))
  returning id into new_id;
  return new_id;
end $$;
revoke all on function private.admin_audit_append(uuid, text, uuid, text, jsonb, jsonb, uuid) from public;

create or replace function private.admin_audit_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'admin_audit is append-only' using errcode = '42501';
end $$;
create trigger admin_audit_no_update before update or delete on public.admin_audit for each row execute function private.admin_audit_immutable();
create trigger admin_audit_no_truncate before truncate on public.admin_audit for each statement execute function private.admin_audit_immutable();

/** Recomputes every hash. Returns {ok, entries, first_bad_id}. */
create or replace function public.admin_verify_audit_chain(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r record;
declare prev text := repeat('0', 64);
declare n bigint := 0;
begin
  perform private.assert_owner(p_actor);
  for r in select * from public.admin_audit order by id loop
    n := n + 1;
    if r.prev_hash <> prev or r.hash <> private.audit_row_hash(r.prev_hash, r.at, r.actor_id, r.action, r.target_profile, r.reason, r.before, r.after, r.request_id) then
      return jsonb_build_object('ok', false, 'entries', n, 'first_bad_id', r.id);
    end if;
    prev := r.hash;
  end loop;
  return jsonb_build_object('ok', true, 'entries', n, 'first_bad_id', null);
end $$;

/** Records an owner READ of sensitive data (e.g. opening a user's full record). */
create or replace function public.admin_log_access(p_actor uuid, p_action text, p_target uuid, p_detail jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_owner(p_actor);
  if p_action !~ '^view\.[a-z_]{3,40}$' then raise exception 'bad access action' using errcode = '22023'; end if;
  perform private.admin_audit_append(p_actor, p_action, p_target, null, '{}', coalesce(p_detail, '{}'), null);
end $$;

-- ---------------------------------------------------------------- the one write path for the owner
create or replace function private.moderation_snapshot(p_profile uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', coalesce(m.status::text, 'active'),
    'suspended_until', m.suspended_until,
    'restrictions', coalesce(to_jsonb(m.restrictions), '[]'),
    'public_reason', m.public_reason,
    'deletion_due_at', m.deletion_due_at,
    'warnings', coalesce(m.warnings, 0),
    'username', p.username,
    'display_name', p.display_name,
    'bio', p.bio,
    'avatar_url', p.avatar_url,
    'flags', (select coalesce(jsonb_agg(f.flag order by f.flag), '[]') from public.moderation_flags f where f.profile_id = p.id and f.removed_at is null)
  )
  from public.profiles p left join public.account_moderation m on m.profile_id = p.id
  where p.id = p_profile;
$$;
revoke all on function private.moderation_snapshot(uuid) from public;

/**
 * Applies ONE owner action atomically. p_params by action:
 *   warn            {notify}
 *   suspend         {hours | permanent:true, public_reason, notify}
 *   ban             {confirm:<username or public id>, public_reason, notify}
 *   reinstate       {notify}
 *   review          {notify}            under review (can still use the app)
 *   restrict        {add:[...], remove:[...], public_reason, notify}
 *   require_reverify{notify}
 *   flag_add        {flag}   flag_remove {flag}
 *   note_add        {body}
 *   edit_profile    {display_name?, username?, bio?, avatar_url?}   ("" clears; username must be unique)
 *   schedule_deletion {confirm, days (1..30), notify}   cancel_deletion {notify}
 *   finalize_deletion {confirm}                        (only once due)
 *   appeal_decide   {appeal_id, accept:bool, note}      accept reinstates
 *   report_set      {report_id, status, resolution}
 * Returns {ok, replay, action_id, auth:{ban_hours|unban|null}}. The web server mirrors `auth` to
 * Supabase Auth (ban / unban) after this commits; the database stays the source of truth.
 */
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
  if p_target = p_actor and p_action not in ('note_add', 'edit_profile') then
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

-- ---------------------------------------------------------------- owner reads
create or replace function private.like_escape(p text) returns text language sql immutable set search_path = '' as $$
  select replace(replace(replace(coalesce(p, ''), '\', '\\'), '%', '\%'), '_', '\_');
$$;

/** Users directory: search, filter, sort, paginate. Returns {total, rows}. */
create or replace function public.admin_list_users(p_actor uuid, p_query text, p_status text, p_sort text, p_limit integer, p_offset integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare q text := nullif(trim(coalesce(p_query, '')), '');
declare pat text := '%' || private.like_escape(lower(q)) || '%';
declare lim integer := least(greatest(coalesce(p_limit, 25), 1), 100);
declare off integer := greatest(coalesce(p_offset, 0), 0);
declare result jsonb;
begin
  perform private.assert_owner(p_actor);
  with base as (
    select p.id, p.username, p.display_name, p.public_id, p.avatar_url, p.created_at,
           u.email::text as email, u.email_confirmed_at, u.last_sign_in_at,
           case
             when p.username is null and coalesce(m.status, 'active') = 'active' then 'pending'
             when private.effective_status(p.id) = 'active' and cardinality(coalesce(m.restrictions, '{}')) > 0 then 'restricted'
             else private.effective_status(p.id)::text
           end as status,
           coalesce(m.restrictions, '{}') as restrictions,
           (select coalesce(jsonb_agg(w.address order by w.is_primary desc), '[]') from public.wallets w where w.profile_id = p.id) as wallets,
           (select la.provider_username from public.linked_accounts la where la.profile_id = p.id and la.provider = 'github') as github,
           (select la.provider_username from public.linked_accounts la where la.profile_id = p.id and la.provider = 'leetcode') as leetcode,
           (select count(*) from public.memberships x where x.profile_id = p.id) as joined,
           (select count(*) from public.memberships x where x.profile_id = p.id and x.status = 'survived') as completed,
           (select count(*) from public.memberships x join public.challenges c on c.id = x.challenge_id where x.profile_id = p.id and c.visibility = 'private') as groups,
           (select count(*) from public.user_reports r where r.reported_id = p.id and r.status in ('open', 'reviewing')) as open_reports,
           (select coalesce(jsonb_agg(f.flag), '[]') from public.moderation_flags f where f.profile_id = p.id and f.removed_at is null) as flags
      from public.profiles p
      left join auth.users u on u.id = p.id
      left join public.account_moderation m on m.profile_id = p.id
     where q is null
        or lower(coalesce(p.username, '')) like pat escape '\'
        or lower(coalesce(p.display_name, '')) like pat escape '\'
        or lower(coalesce(u.email::text, '')) like pat escape '\'
        or p.id::text = lower(q)
        or lower(p.public_id) = lower(q)
        or exists (select 1 from public.wallets w where w.profile_id = p.id and w.address = q)
        or exists (select 1 from public.linked_accounts la where la.profile_id = p.id and lower(la.provider_username) like pat escape '\')
  ), filtered as (
    select * from base where p_status is null or p_status = 'all' or status = p_status
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((select jsonb_agg(to_jsonb(f.*)) from (
      select * from filtered
       order by
         case when p_sort = 'created_asc' then created_at end asc,
         case when p_sort = 'last_active' then last_sign_in_at end desc nulls last,
         case when p_sort = 'username' then username end asc nulls last,
         case when p_sort = 'reports' then open_reports end desc,
         created_at desc
       limit lim offset off) f), '[]')
  ) into result;
  return result;
end $$;

/** Platform overview: totals and 30-day daily series (real rows only). */
create or replace function public.admin_overview(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform private.assert_owner(p_actor);
  with days as (select generate_series((now() at time zone 'UTC')::date - 29, (now() at time zone 'UTC')::date, interval '1 day')::date as d)
  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'active_7d', (select count(*) from auth.users u where u.last_sign_in_at > now() - interval '7 days'),
    'new_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'suspended', (select count(*) from public.account_moderation m where private.effective_status(m.profile_id) = 'suspended'),
    'banned', (select count(*) from public.account_moderation where status = 'banned'),
    'challenges', (select count(*) from public.challenges where onchain_address is not null),
    'challenges_open', (select count(*) from public.challenges where onchain_address is not null and pool_state = 'open'),
    'challenges_settled', (select count(*) from public.challenges where pool_state = 'settled'),
    'groups', (select count(*) from public.challenges where onchain_address is not null and visibility = 'private'),
    'verified_days', (select count(*) from public.day_results where result = 'verified' and onchain_at is not null),
    'usdc_staked', (select coalesce(sum(r.amount), 0)::text from public.receipts r join public.challenges c on c.id = r.challenge_id where c.token = 'usdc' and r.kind in ('join', 'sponsor', 'shield')),
    'sol_staked', (select coalesce(sum(r.amount), 0)::text from public.receipts r join public.challenges c on c.id = r.challenge_id where c.token = 'sol' and r.kind in ('join', 'sponsor', 'shield')),
    'sponsorships', (select count(*) from public.sponsorships),
    'pending_claims', (select count(*) from public.memberships m join public.challenges c on c.id = m.challenge_id where c.pool_state in ('settled', 'cancelled') and m.claimed_at is null and (m.status in ('survived', 'voided') or c.pool_state = 'cancelled')),
    'failed_transactions', (select count(*) from public.relayer_requests where status = 'failed'),
    'failed_days', (select count(*) from public.day_results where result = 'failed' and onchain_at is not null),
    'indeterminate_days', (select count(*) from public.day_results where result = 'indeterminate' and onchain_at is not null),
    'open_reports', (select count(*) from public.user_reports where status in ('open', 'reviewing')),
    'open_appeals', (select count(*) from public.moderation_appeals where status = 'open'),
    'series', (select jsonb_agg(jsonb_build_object(
        'date', days.d,
        'signups', (select count(*) from public.profiles p where (p.created_at at time zone 'UTC')::date = days.d),
        'verified', (select count(*) from public.day_results r where r.result = 'verified' and (r.onchain_at at time zone 'UTC')::date = days.d),
        'failed', (select count(*) from public.day_results r where r.result = 'failed' and (r.onchain_at at time zone 'UTC')::date = days.d),
        'indeterminate', (select count(*) from public.day_results r where r.result = 'indeterminate' and (r.onchain_at at time zone 'UTC')::date = days.d),
        'joins', (select count(*) from public.memberships m where (m.joined_at at time zone 'UTC')::date = days.d),
        'transactions', (select count(*) from public.receipts r where (r.confirmed_at at time zone 'UTC')::date = days.d)
      ) order by days.d) from days)
  ) into result;
  return result;
end $$;

/** Owner-only auth metadata for one user (email, confirmation, sign-in times). No tokens, no hashes. */
create or replace function public.admin_auth_info(p_actor uuid, p_target uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_owner(p_actor);
  return (select jsonb_build_object('email', u.email, 'email_confirmed_at', u.email_confirmed_at, 'last_sign_in_at', u.last_sign_in_at,
                                    'created_at', u.created_at, 'banned_until', u.banned_until)
            from auth.users u where u.id = p_target);
end $$;

-- Expired suspensions become active again (also handled live by effective_status).
create or replace function private.expire_suspensions() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  update public.account_moderation set status = 'active', suspended_until = null, updated_at = now()
   where status = 'suspended' and suspended_until is not null and suspended_until <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.expire_suspensions() from public;

-- Notifications get an "account" kind for moderation messages.
alter type public.notification_kind add value if not exists 'account';

-- Grants: owner functions are for the web server only.
do $$
declare f text;
begin
  foreach f in array array[
    'public.admin_moderate(uuid, uuid, text, text, jsonb, uuid)',
    'public.admin_list_users(uuid, text, text, text, integer, integer)',
    'public.admin_overview(uuid)',
    'public.admin_auth_info(uuid, uuid)',
    'public.admin_verify_audit_chain(uuid)',
    'public.admin_log_access(uuid, text, uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('codestreak-expire-suspensions', '*/10 * * * *', $job$select private.expire_suspensions()$job$);
  else
    raise notice 'pg_cron not available: suspension expiry runs live via effective_status only';
  end if;
end $$;
