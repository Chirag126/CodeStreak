-- Phase 33 - Smart alerts & verification intelligence.
--
-- Replaces the planned ElevenLabs voice coach: the unused voice_clips placeholder (no rows, no
-- storage) is removed. Notifications are made inside the database, by triggers on the tables
-- that already record each event, so every path (web, relayer, worker, reconcile) notifies the
-- same way. Deadline warnings come from a pg_cron job (pure SQL, no worker wake, no paid service).
--
--   recipient rules: you are never notified about your own action
--   dedupe:          unique (profile_id, dedupe_key), every insert is "on conflict do nothing"
--   privacy:         RLS: you read only your own notifications; Realtime applies the same RLS
--   read state:      mark_notifications_read() changes only read_at, only on your own rows

-- ---------------------------------------------------------------- remove the voice placeholder
drop table if exists public.voice_clips;
drop type if exists public.voice_clip_kind;

-- ---------------------------------------------------------------- notifications
create type public.notification_kind as enum (
  'invitation', 'member_joined', 'sponsorship', 'day_result', 'deadline_warning', 'settlement', 'payout', 'dispute', 'badge'
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind public.notification_kind not null,
  title text not null check (char_length(title) between 1 and 140),
  body text not null default '' check (char_length(body) <= 500),
  href text check (href ~ '^/[A-Za-z0-9/_#?=&.-]*$' and char_length(href) <= 200),
  challenge_id uuid references public.challenges (id) on delete cascade,
  dedupe_key text not null check (char_length(dedupe_key) between 1 and 200),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (profile_id, dedupe_key)
);
create index notifications_inbox on public.notifications (profile_id, created_at desc);
create index notifications_unread on public.notifications (profile_id) where read_at is null;

alter table public.notifications enable row level security;
create policy "own notifications" on public.notifications for select to authenticated
  using (profile_id = (select auth.uid()));
grant select on public.notifications to authenticated;
revoke insert, update, delete, truncate on public.notifications from anon, authenticated;
-- Realtime: the browser subscribes to its own inserts/updates (RLS decides who receives what).
alter publication supabase_realtime add table public.notifications;

/** The one way notifications are created. Returns true when it was new. */
create or replace function private.notify(
  p_profile uuid, p_kind public.notification_kind, p_title text, p_body text, p_href text, p_challenge uuid, p_dedupe text
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_profile is null then return false; end if;
  insert into public.notifications (profile_id, kind, title, body, href, challenge_id, dedupe_key)
  values (p_profile, p_kind, left(p_title, 140), left(coalesce(p_body, ''), 500), p_href, p_challenge, left(p_dedupe, 200))
  on conflict (profile_id, dedupe_key) do nothing;
  return found;
end $$;
revoke all on function private.notify(uuid, public.notification_kind, text, text, text, uuid, text) from public;

/** "0.01 SOL", "1.5 USDC": base units to a short amount. */
create or replace function private.fmt_amount(units numeric, token public.stake_token) returns text
language sql immutable set search_path = '' as $$
  select trim(trailing '.' from trim(trailing '0' from to_char(units / power(10, case when token = 'sol' then 9 else 6 end), 'FM999999990.999999999')))
         || case when token = 'sol' then ' SOL' else ' USDC' end;
$$;

create or replace function private.username_of(p uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce('@' || (select username from public.profiles where id = p), 'Someone');
$$;
revoke all on function private.username_of(uuid) from public;

/** Marks your notifications read: the given ids, or all of them when p_ids is null. Returns how many. */
create or replace function public.mark_notifications_read(p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  update public.notifications set read_at = now()
   where profile_id = (select auth.uid()) and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- ---------------------------------------------------------------- event triggers

create or replace function private.notify_invitation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.challenges;
begin
  if new.invitee_id is null or new.status <> 'pending' then return null; end if;
  select * into c from public.challenges where id = new.challenge_id;
  perform private.notify(new.invitee_id, 'invitation', private.username_of(new.invited_by) || ' invited you to ' || c.title,
    'Open your dashboard to accept or decline.', '/dashboard', c.id, 'invite:' || new.id);
  return null;
end $$;

create or replace function private.notify_member_joined() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.challenges;
begin
  select * into c from public.challenges where id = new.challenge_id;
  if c.creator_id is distinct from new.profile_id then
    perform private.notify(c.creator_id, 'member_joined', private.username_of(new.profile_id) || ' joined ' || c.title,
      'Players: ' || c.participant_count || ' of ' || c.max_participants || '.', '/challenges/' || c.onchain_address, c.id, 'joined:' || new.id);
  end if;
  return null;
end $$;

create or replace function private.notify_sponsorship() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.challenges; r record;
begin
  select * into c from public.challenges where id = new.challenge_id;
  for r in
    select distinct x.profile_id from (
      select c.creator_id as profile_id
      union all select m.profile_id from public.memberships m where m.challenge_id = c.id
    ) x where x.profile_id is not null and x.profile_id is distinct from new.sponsor_id
  loop
    perform private.notify(r.profile_id, 'sponsorship', 'A sponsor added ' || private.fmt_amount(new.amount, c.token) || ' to ' || c.title,
      coalesce('"' || new.message || '"', 'It goes to the players who keep their streak.'), '/challenges/' || c.onchain_address, c.id, 'sponsor:' || new.id);
  end loop;
  return null;
end $$;

create or replace function private.notify_day_result() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; c public.challenges;
begin
  -- Only results recorded on-chain (final), and again when a dispute upgrades one.
  if new.onchain_at is null or (tg_op = 'UPDATE' and old.onchain_at is not null and old.result = new.result) then return null; end if;
  select * into m from public.memberships where id = new.membership_id;
  select * into c from public.challenges where id = m.challenge_id;
  perform private.notify(m.profile_id, 'day_result',
    'Day ' || (new.day + 1) || case new.result when 'verified' then ' verified' when 'failed' then ' missed' else ' could not be verified' end || ' · ' || c.title,
    case new.result
      when 'verified' then case when new.source = 'dispute' then 'Your dispute was accepted and recorded on-chain.' else 'Recorded on-chain. Keep the streak going.' end
      when 'failed' then 'Recorded on-chain. A Shield bought before the grace ends, or a dispute, can still rescue it.'
      else 'The data was not reliable enough to decide, so the day does not count as a fail. See why on the challenge page.' end,
    '/challenges/' || c.onchain_address || '#my-days', c.id, 'day:' || new.membership_id || ':' || new.day || ':' || new.result);
  return null;
end $$;

create or replace function private.notify_settlement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if old.pool_state <> 'open' or new.pool_state = 'open' then return null; end if;
  for r in select m.profile_id from public.memberships m where m.challenge_id = new.id loop
    perform private.notify(r.profile_id, 'settlement',
      new.title || case when new.pool_state = 'settled' then ' settled' else ' was cancelled' end,
      case when new.pool_state = 'settled' then 'Results are final. Rewards and refunds are sent to your wallet automatically.'
           else 'Too few players joined. Your stake is refunded automatically.' end,
      '/dashboard/claims', new.id, new.pool_state::text || ':' || new.id);
  end loop;
  return null;
end $$;

create or replace function private.notify_payout() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.challenges;
begin
  if new.kind not in ('reward', 'refund', 'sponsor_refund') or new.profile_id is null then return null; end if;
  select * into c from public.challenges where id = new.challenge_id;
  perform private.notify(new.profile_id, 'payout',
    case new.kind when 'reward' then 'Your reward of ' when 'refund' then 'Your refund of ' else 'Your sponsorship refund of ' end
      || private.fmt_amount(new.amount, c.token) || ' arrived',
    c.title || case when c.token = 'sol' then ' · it arrived as wrapped SOL: unwrap it in Payouts.' else '.' end,
    '/dashboard/claims', c.id, 'payout:' || new.id);
  return null;
end $$;

create or replace function private.notify_dispute_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d public.disputes; c public.challenges;
begin
  if new.action = 'opened' then return null; end if;
  select * into d from public.disputes where id = new.dispute_id;
  select ch.* into c from public.challenges ch join public.memberships m on m.challenge_id = ch.id where m.id = d.membership_id;
  perform private.notify(d.opened_by, 'dispute',
    'Dispute for day ' || (d.day + 1) || ': ' || case new.action when 'approved' then 'approved' when 'rejected' then 'rejected'
      when 'resolved' then 'day verified on-chain' when 'expired' then 'expired' else 'could not be applied' end,
    coalesce(new.note, c.title), '/dashboard/disputes', c.id, 'dispute:' || new.id);
  return null;
end $$;

create or replace function private.notify_badge() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(new.profile_id, 'badge', 'You earned a badge: ' || coalesce((select name from public.badge_types where code = new.badge_code), new.badge_code),
    'It is on your profile.', '/dashboard', new.challenge_id, 'badge:' || new.id);
  return null;
end $$;

revoke all on function private.notify_invitation(), private.notify_member_joined(), private.notify_sponsorship(), private.notify_day_result(),
  private.notify_settlement(), private.notify_payout(), private.notify_dispute_event(), private.notify_badge() from public;

create trigger notify_invitation after insert on public.invitations for each row execute function private.notify_invitation();
create trigger notify_member_joined after insert on public.memberships for each row execute function private.notify_member_joined();
create trigger notify_sponsorship after insert on public.sponsorships for each row execute function private.notify_sponsorship();
create trigger notify_day_result after insert or update of onchain_at, result on public.day_results for each row execute function private.notify_day_result();
create trigger notify_settlement after update of pool_state on public.challenges for each row execute function private.notify_settlement();
create trigger notify_payout after insert on public.receipts for each row execute function private.notify_payout();
create trigger notify_dispute_event after insert on public.dispute_events for each row execute function private.notify_dispute_event();
create trigger notify_badge after insert on public.badges for each row execute function private.notify_badge();

-- ---------------------------------------------------------------- deadline warnings (UTC)

/**
 * How long before a day ends the warning goes out: 3 hours for real (12 h+) days; a quarter of
 * the day (at least a minute) for short demo days, where 3 hours would be before the day starts.
 * Mirrored in packages/shared/src/deadline.ts.
 */
create or replace function private.warning_lead_secs(day_length_secs integer) returns integer
language sql immutable set search_path = '' as $$
  select case when day_length_secs >= 43200 then 10800 else greatest(60, day_length_secs / 4) end;
$$;

/**
 * For every running challenge whose current day ends within the warning lead: warn each active
 * player whose day is still unverified (no verified result, no Shield, and the latest "Check now"
 * didn't meet the goal under the challenge's ANY/ALL rule). One warning per player and day.
 * Returns how many were sent. Also prunes read notifications older than 60 days.
 */
create or replace function private.send_deadline_warnings(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  sent integer := 0;
  r record;
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
    select due.id as challenge_id, due.title, due.onchain_address, due.day, due.ends_at, m.id as membership_id, m.profile_id,
           case when (due.rules ->> 'providerRule') = 'all' then greatest(1, coalesce(jsonb_array_length(due.rules -> 'providers'), 1)) else 1 end as needed
      from due
      join public.memberships m on m.challenge_id = due.id and m.status = 'active'
     where p_now >= due.ends_at - make_interval(secs => private.warning_lead_secs(due.day_length_secs))
       and not exists (select 1 from public.day_results d where d.membership_id = m.id and d.day = due.day and d.result = 'verified')
       and not exists (select 1 from public.shields s where s.membership_id = m.id and s.day = due.day)
  loop
    if (select count(*) from public.member_day_checks k where k.membership_id = r.membership_id and k.day = r.day and k.outcome = 'met') >= r.needed then
      continue; -- the latest check already met the goal
    end if;
    if private.notify(r.profile_id, 'deadline_warning',
         'Day ' || (r.day + 1) || ' of ' || r.title || ' ends at ' || to_char(r.ends_at at time zone 'UTC', 'HH24:MI') || ' UTC',
         'Today is not verified yet (' || greatest(1, ceil(extract(epoch from r.ends_at - p_now) / 60))::integer || ' min left). If you already did it, open the challenge and press Check now.',
         '/challenges/' || r.onchain_address, r.challenge_id, 'deadline:' || r.membership_id || ':' || r.day) then
      sent := sent + 1;
    end if;
  end loop;
  delete from public.notifications where read_at is not null and read_at < p_now - interval '60 days';
  return sent;
end $$;
revoke all on function private.send_deadline_warnings(timestamptz) from public;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('codestreak-deadline-warnings', '* * * * *', $job$select private.send_deadline_warnings()$job$);
  else
    raise notice 'pg_cron not available: deadline warnings not scheduled (expected outside Supabase)';
  end if;
end $$;
