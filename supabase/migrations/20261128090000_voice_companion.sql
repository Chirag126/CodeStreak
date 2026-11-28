-- Phase 41.2: voice companion and smarter deadline alerts.
--
-- 1. Notification preferences (per user): deadlines, day results, rewards, group updates, plus the
--    voice and browser-notification switches. private.notify checks them, so every existing
--    trigger respects them without change. Account notices (moderation) are always delivered.
-- 2. Deadline warnings: a second, final warning close to the end ("Last call"), and end times shown
--    in the player's own time zone (profiles.timezone; unknown zones fall back to UTC).
-- 3. Voice: one global settings row (owner kill switches and app-side limits), a cache index of
--    generated clips (the audio itself is in the private `voice` storage bucket) and a usage log.
--    Only the server (service role) touches these; the owner changes settings through one audited
--    function. Nothing here ever moves money.

-- ---------------------------------------------------------------- 1. notification preferences
create table public.notification_prefs (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  deadlines boolean not null default true,
  results boolean not null default true,
  rewards boolean not null default true,
  group_updates boolean not null default true,
  voice boolean not null default true,
  browser boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
create policy "users read their own notification preferences" on public.notification_prefs for select to authenticated
  using (profile_id = (select auth.uid()));
revoke all on table public.notification_prefs from anon;
revoke insert, update, delete, truncate on table public.notification_prefs from authenticated;
grant select on table public.notification_prefs to authenticated;

/** Which preference switch governs a notification kind; null = always delivered (account notices). */
create or replace function private.notification_category(p_kind public.notification_kind) returns text
language sql immutable set search_path = '' as $$
  select case p_kind::text
    when 'deadline_warning' then 'deadlines'
    when 'day_result' then 'results'
    when 'dispute' then 'results'
    when 'settlement' then 'rewards'
    when 'payout' then 'rewards'
    when 'badge' then 'rewards'
    when 'invitation' then 'group_updates'
    when 'member_joined' then 'group_updates'
    when 'sponsorship' then 'group_updates'
    else null
  end;
$$;

create or replace function private.wants_notification(p_profile uuid, p_kind public.notification_kind) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case private.notification_category(p_kind)
      when 'deadlines' then np.deadlines
      when 'results' then np.results
      when 'rewards' then np.rewards
      when 'group_updates' then np.group_updates
      else true
    end
    from public.notification_prefs np where np.profile_id = p_profile
  ), true);
$$;
revoke all on function private.wants_notification(uuid, public.notification_kind) from public;

/** The one way notifications are created (Phase 33), now respecting the player's preferences. */
create or replace function private.notify(
  p_profile uuid, p_kind public.notification_kind, p_title text, p_body text, p_href text, p_challenge uuid, p_dedupe text
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_profile is null then return false; end if;
  if not private.wants_notification(p_profile, p_kind) then return false; end if;
  insert into public.notifications (profile_id, kind, title, body, href, challenge_id, dedupe_key)
  values (p_profile, p_kind, left(p_title, 140), left(coalesce(p_body, ''), 500), p_href, p_challenge, left(p_dedupe, 200))
  on conflict (profile_id, dedupe_key) do nothing;
  return found;
end $$;
revoke all on function private.notify(uuid, public.notification_kind, text, text, text, uuid, text) from public;

/** Saves the signed-in user's preferences (only the keys given; unknown keys are refused). */
create or replace function private.set_notification_prefs(p_prefs jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
declare k text;
declare out_row public.notification_prefs;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then raise exception 'Preferences must be an object.' using errcode = '22023'; end if;
  for k in select jsonb_object_keys(p_prefs) loop
    if k not in ('deadlines', 'results', 'rewards', 'group_updates', 'voice', 'browser') then
      raise exception 'Unknown preference: %', left(k, 40) using errcode = '22023';
    end if;
    if jsonb_typeof(p_prefs -> k) <> 'boolean' then
      raise exception 'Preference % must be true or false.', k using errcode = '22023';
    end if;
  end loop;
  insert into public.notification_prefs (profile_id) values (me) on conflict (profile_id) do nothing;
  update public.notification_prefs np set
    deadlines = coalesce((p_prefs ->> 'deadlines')::boolean, np.deadlines),
    results = coalesce((p_prefs ->> 'results')::boolean, np.results),
    rewards = coalesce((p_prefs ->> 'rewards')::boolean, np.rewards),
    group_updates = coalesce((p_prefs ->> 'group_updates')::boolean, np.group_updates),
    voice = coalesce((p_prefs ->> 'voice')::boolean, np.voice),
    browser = coalesce((p_prefs ->> 'browser')::boolean, np.browser),
    updated_at = now()
  where np.profile_id = me
  returning * into out_row;
  return to_jsonb(out_row) - 'profile_id';
end $$;
revoke all on function private.set_notification_prefs(jsonb) from public, anon;
grant execute on function private.set_notification_prefs(jsonb) to authenticated, service_role;

create function public.set_notification_prefs(p_prefs jsonb) returns jsonb
language sql volatile security invoker set search_path = '' as $$ select private.set_notification_prefs(p_prefs) $$;
revoke all on function public.set_notification_prefs(jsonb) from public, anon;
grant execute on function public.set_notification_prefs(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------- 2. deadline warnings: final call + local time

/** The final "last call" lead: 30 minutes for real days, a twelfth of the day (≥ 1 min) on demo days. Mirrored in deadline.ts. */
create or replace function private.final_lead_secs(day_length_secs integer) returns integer
language sql immutable set search_path = '' as $$
  select case when day_length_secs >= 43200 then 1800 else greatest(60, day_length_secs / 12) end;
$$;

/**
 * Every running challenge whose current day ends within the warning lead: warn each active player
 * whose day is still unverified (no verified result, no Shield, latest check not met). Two tiers,
 * one notification each per player and day: the early warning, then a final one inside the final
 * lead (only when that is shorter than the early lead, so short demo days don't get two at once).
 * End times are shown in the player's time zone. Prunes read notifications older than 60 days.
 */
create or replace function private.send_deadline_warnings(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  sent integer := 0;
  r record;
  secs_left integer;
  is_final boolean;
  local_end text;
begin
  for r in
    with running as (
      select c.*, floor(extract(epoch from p_now - c.start_at) / c.day_length_secs)::integer as day
        from public.challenges c
       where c.pool_state = 'open' and c.onchain_address is not null
         and p_now >= c.start_at and p_now < c.start_at + make_interval(secs => c.num_days::double precision * c.day_length_secs)
    ), due as (
      select running.*, running.start_at + make_interval(secs => (running.day + 1)::double precision * running.day_length_secs) as ends_at
        from running
    )
    select due.id as challenge_id, due.title, due.onchain_address, due.day, due.ends_at, due.day_length_secs, m.id as membership_id, m.profile_id,
           coalesce(tz.name, 'UTC') as tz_name, coalesce(tz.abbrev, 'UTC') as tz_abbrev,
           case when (due.rules ->> 'providerRule') = 'all' then greatest(1, coalesce(jsonb_array_length(due.rules -> 'providers'), 1)) else 1 end as needed
      from due
      join public.memberships m on m.challenge_id = due.id and m.status = 'active'
      join public.profiles p on p.id = m.profile_id
      left join lateral (select z.name, z.abbrev from pg_catalog.pg_timezone_names z where z.name = p.timezone limit 1) tz on true
     where p_now >= due.ends_at - make_interval(secs => private.warning_lead_secs(due.day_length_secs))
       and not exists (select 1 from public.day_results d where d.membership_id = m.id and d.day = due.day and d.result = 'verified')
       and not exists (select 1 from public.shields s where s.membership_id = m.id and s.day = due.day)
  loop
    if (select count(*) from public.member_day_checks k where k.membership_id = r.membership_id and k.day = r.day and k.outcome = 'met') >= r.needed then
      continue; -- the latest check already met the goal
    end if;
    secs_left := greatest(1, ceil(extract(epoch from r.ends_at - p_now))::integer);
    is_final := private.final_lead_secs(r.day_length_secs) < private.warning_lead_secs(r.day_length_secs)
                and secs_left <= private.final_lead_secs(r.day_length_secs);
    local_end := to_char(r.ends_at at time zone r.tz_name, 'HH24:MI') || ' ' || r.tz_abbrev;
    if is_final then
      if private.notify(r.profile_id, 'deadline_warning',
           'Last call: day ' || (r.day + 1) || ' of ' || r.title || ' ends in ' || greatest(1, ceil(secs_left / 60.0))::integer || ' min',
           'Today still isn''t verified. Push your code (or solve on LeetCode) now, then open the challenge and press Check now. Ends at ' || local_end || '.',
           '/challenges/' || r.onchain_address, r.challenge_id, 'deadline-final:' || r.membership_id || ':' || r.day) then
        sent := sent + 1;
      end if;
    else
      if private.notify(r.profile_id, 'deadline_warning',
           'Day ' || (r.day + 1) || ' of ' || r.title || ' ends at ' || local_end,
           'Today is not verified yet (' || greatest(1, ceil(secs_left / 60.0))::integer || ' min left). If you already did it, open the challenge and press Check now.',
           '/challenges/' || r.onchain_address, r.challenge_id, 'deadline:' || r.membership_id || ':' || r.day) then
        sent := sent + 1;
      end if;
    end if;
  end loop;
  delete from public.notifications where read_at is not null and read_at < p_now - interval '60 days';
  return sent;
end $$;
revoke all on function private.send_deadline_warnings(timestamptz) from public;

-- ---------------------------------------------------------------- 3. voice: settings, cache index, usage log
create table public.voice_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  announcements boolean not null default true,
  monthly_char_limit integer not null default 60000 check (monthly_char_limit between 0 and 10000000),
  user_daily_limit integer not null default 15 check (user_daily_limit between 0 and 1000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
insert into public.voice_settings default values;

create table public.voice_clips (
  hash text primary key check (hash ~ '^[0-9a-f]{64}$'),
  path text not null check (char_length(path) <= 200),
  chars integer not null check (chars > 0),
  voice_id text not null check (char_length(voice_id) <= 64),
  model_id text not null check (char_length(model_id) <= 64),
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  plays integer not null default 1 check (plays >= 0)
);
create index voice_clips_last_used on public.voice_clips (last_used_at);

create table public.voice_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  profile_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('briefing', 'announcement')),
  outcome text not null check (outcome in ('generated', 'cached', 'fallback_disabled', 'fallback_limit', 'fallback_unconfigured', 'error')),
  chars integer not null default 0 check (chars >= 0),
  latency_ms integer check (latency_ms >= 0),
  error text check (char_length(error) <= 300)
);
create index voice_events_at on public.voice_events (at desc);
create index voice_events_profile on public.voice_events (profile_id, at desc);

do $$
declare t text;
begin
  foreach t in array array['voice_settings', 'voice_clips', 'voice_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('create policy "no direct access" on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', t);
  end loop;
end $$;

/**
 * Called by the server before it asks ElevenLabs for new audio. Checks the kill switches and the
 * app-side limits, and if allowed records the generation up front (so concurrent requests count),
 * returning its id; the server reports the result with voice_finish. Cache hits and fallbacks are
 * logged with voice_log and never count against the limits.
 */
create or replace function public.voice_reserve(p_profile uuid, p_kind text, p_chars integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.voice_settings;
declare used bigint;
declare today_count bigint;
declare ev bigint;
begin
  if p_kind not in ('briefing', 'announcement') or p_chars is null or p_chars < 1 or p_chars > 5000 then
    raise exception 'invalid voice request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('codestreak.voice_reserve'));
  select * into s from public.voice_settings where id;
  if not coalesce(s.enabled, false) then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
  if p_kind = 'announcement' and not s.announcements then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
  select coalesce(sum(e.chars), 0) into used from public.voice_events e
   where e.outcome = 'generated' and e.at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  if used + p_chars > s.monthly_char_limit then return jsonb_build_object('ok', false, 'reason', 'monthly_limit'); end if;
  if p_profile is not null then
    select count(*) into today_count from public.voice_events e
     where e.profile_id = p_profile and e.outcome = 'generated' and e.at > now() - interval '1 day';
    if today_count >= s.user_daily_limit then return jsonb_build_object('ok', false, 'reason', 'daily_limit'); end if;
  end if;
  insert into public.voice_events (profile_id, kind, outcome, chars) values (p_profile, p_kind, 'generated', p_chars) returning id into ev;
  delete from public.voice_events where at < now() - interval '180 days';
  return jsonb_build_object('ok', true, 'event', ev);
end $$;

/** The outcome of a reserved generation: success keeps it counted; a failure becomes an error (not counted). */
create or replace function public.voice_finish(p_event bigint, p_ok boolean, p_latency_ms integer, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.voice_events
     set outcome = case when p_ok then 'generated' else 'error' end,
         latency_ms = greatest(0, p_latency_ms),
         error = case when p_ok then null else left(coalesce(p_error, 'unknown error'), 300) end
   where id = p_event;
$$;

/** Cache hits and fallbacks (never counted against the limits). */
create or replace function public.voice_log(p_profile uuid, p_kind text, p_outcome text, p_chars integer, p_latency_ms integer, p_error text) returns void
language sql security definer set search_path = '' as $$
  insert into public.voice_events (profile_id, kind, outcome, chars, latency_ms, error)
  values (p_profile, p_kind, p_outcome, greatest(0, coalesce(p_chars, 0)), greatest(0, p_latency_ms), left(p_error, 300));
$$;

/** Settings the server needs on every request (kill switches). */
create or replace function public.voice_settings_get() returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(s) - 'id' - 'updated_by' from public.voice_settings s where s.id;
$$;

/** Control Center: this month's usage, cache effectiveness and recent errors. */
create or replace function public.admin_voice_overview(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare month_start timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
declare v_out jsonb;
begin
  perform private.assert_owner(p_actor);
  select jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' from public.voice_settings s where s.id),
    'month', (select jsonb_build_object(
        'generated', count(*) filter (where e.outcome = 'generated'),
        'cached', count(*) filter (where e.outcome = 'cached'),
        'fallbacks', count(*) filter (where e.outcome like 'fallback_%'),
        'errors', count(*) filter (where e.outcome = 'error'),
        'chars', coalesce(sum(e.chars) filter (where e.outcome = 'generated'), 0),
        'briefings', count(*) filter (where e.kind = 'briefing' and e.outcome in ('generated', 'cached')),
        'announcements', count(*) filter (where e.kind = 'announcement' and e.outcome in ('generated', 'cached')),
        'users', count(distinct e.profile_id))
      from public.voice_events e where e.at >= month_start),
    'clips', (select jsonb_build_object('count', count(*), 'plays', coalesce(sum(c.plays), 0)) from public.voice_clips c),
    'recent_errors', coalesce((select jsonb_agg(jsonb_build_object('at', x.at, 'kind', x.kind, 'error', x.error) order by x.at desc)
        from (select e.at, e.kind, e.error from public.voice_events e where e.outcome = 'error' order by e.at desc limit 8) x), '[]'::jsonb)
  ) into v_out;
  return v_out;
end $$;

/** Owner-only change of the voice switches and app-side limits; audited (hash-chained). */
create or replace function public.admin_voice_settings_set(p_actor uuid, p_enabled boolean, p_announcements boolean, p_monthly_char_limit integer, p_user_daily_limit integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare before jsonb;
declare after jsonb;
begin
  perform private.assert_owner(p_actor);
  if p_enabled is null or p_announcements is null or p_monthly_char_limit is null or p_user_daily_limit is null then
    raise exception 'All four settings are required.' using errcode = '22023';
  end if;
  if p_monthly_char_limit not between 0 and 10000000 then raise exception 'Monthly limit must be between 0 and 10,000,000 characters.' using errcode = '22023'; end if;
  if p_user_daily_limit not between 0 and 1000 then raise exception 'Per-user daily limit must be between 0 and 1,000.' using errcode = '22023'; end if;
  select to_jsonb(s) - 'id' - 'updated_at' - 'updated_by' into before from public.voice_settings s where s.id;
  update public.voice_settings set enabled = p_enabled, announcements = p_announcements, monthly_char_limit = p_monthly_char_limit,
         user_daily_limit = p_user_daily_limit, updated_at = now(), updated_by = p_actor
   where id;
  select to_jsonb(s) - 'id' - 'updated_at' - 'updated_by' into after from public.voice_settings s where s.id;
  if before is distinct from after then
    perform private.admin_audit_append(p_actor, 'settings.voice', null, 'Voice settings changed', before, after, null);
  end if;
  return after;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.voice_reserve(uuid, text, integer)', 'public.voice_finish(bigint, boolean, integer, text)',
    'public.voice_log(uuid, text, text, integer, integer, text)', 'public.voice_settings_get()',
    'public.admin_voice_overview(uuid)', 'public.admin_voice_settings_set(uuid, boolean, boolean, integer, integer)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- 4. private storage bucket for the audio
-- Only on Supabase (CI's plain Postgres has no storage schema). Private: the server hands out
-- short-lived signed links; nothing is listable or public.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'storage' and c.relname = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('voice', 'voice', false, 2097152, array['audio/mpeg'])
    on conflict (id) do nothing;
  end if;
end $$;
