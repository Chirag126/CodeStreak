-- Phase 31 - Disputes.
--
--   player  : open_dispute()    a recorded "failed" / "could not verify" day, before the dispute window
--                                closes (the program's own deadline for upgrading a day)
--   admin   : review_dispute()   approve or reject, with a note (only people in public.admins)
--   worker  : resolve_dispute()  after an approval: record_verification(day, verified) signed by the
--                                verifier, a dispute receipt replaces the day's receipt, the day becomes
--                                verified; or expire_dispute() when the window closed first
-- Every step is in dispute_events (the ticket's timeline, visible to its owner and admins) and in
-- audit_log. Tables are written only through these functions.

-- ---------------------------------------------------------------- admins
create table public.admins (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- No policies: nobody reads it through the API; private.is_admin() is the only door.

create or replace function private.is_admin(uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select uid is not null and exists (select 1 from public.admins a where a.profile_id = uid);
$$;
revoke all on function private.is_admin(uuid) from public;
grant execute on function private.is_admin(uuid) to authenticated, service_role;

/** For the web app: is the signed-in user an admin? */
create or replace function public.am_i_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin((select auth.uid()));
$$;
revoke all on function public.am_i_admin() from public, anon;
grant execute on function public.am_i_admin() to authenticated;

-- ---------------------------------------------------------------- disputes
-- Phase 11 created an unused placeholder (no rows anywhere; members could see each other's tickets).
-- It is replaced: tickets are private to their owner and admins, and carry the review and resolution.
drop table public.disputes;
drop type public.dispute_status;
create type public.dispute_status as enum ('open', 'approved', 'rejected', 'resolved', 'expired', 'failed');

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships (id) on delete cascade,
  day smallint not null check (day between 0 and 59),
  opened_by uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (char_length(reason) between 20 and 2000),
  evidence_urls text[] not null default '{}' check (cardinality(evidence_urls) <= 5),
  status public.dispute_status not null default 'open',
  previous_result public.day_result not null,
  previous_hash text not null check (previous_hash ~ '^[0-9a-f]{64}$'),
  reviewer_id uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (char_length(review_note) <= 1000),
  resolution_tx public.tx_signature unique,
  resolved_at timestamptz,
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One live ticket per player-day.
create unique index disputes_one_live on public.disputes (membership_id, day) where status in ('open', 'approved');
create index disputes_status on public.disputes (status, created_at);

create table public.dispute_events (
  id bigint generated always as identity primary key,
  dispute_id uuid not null references public.disputes (id) on delete cascade,
  at timestamptz not null default now(),
  actor_kind public.actor_kind not null,
  action text not null check (action in ('opened', 'approved', 'rejected', 'resolved', 'expired', 'failed')),
  note text check (char_length(note) <= 1000)
);
create index dispute_events_dispute on public.dispute_events (dispute_id, at);

alter table public.disputes enable row level security;
alter table public.dispute_events enable row level security;
-- Your own tickets, or every ticket for admins. Nobody else sees a dispute at all.
create policy "own or admin" on public.disputes for select to authenticated
  using (opened_by = (select auth.uid()) or private.is_admin((select auth.uid())));
create policy "own or admin" on public.dispute_events for select to authenticated
  using (exists (select 1 from public.disputes d where d.id = dispute_id
                  and (d.opened_by = (select auth.uid()) or private.is_admin((select auth.uid())))));
grant select on public.disputes, public.dispute_events to authenticated;

-- Dispute receipts replace the day's receipt after an upgrade (engine "codestreak-dispute/1").
alter table public.day_receipts drop constraint day_receipts_engine_check;
alter table public.day_receipts add constraint day_receipts_engine_check check (engine ~ '^codestreak-(rules|dispute)/[0-9]+$');

/** The moment the program stops accepting upgrades for a challenge. */
create or replace function private.dispute_end(c public.challenges) returns timestamptz
language sql immutable set search_path = '' as $$
  select c.start_at + make_interval(secs => c.num_days::double precision * c.day_length_secs + c.verify_window_secs + c.dispute_window_secs);
$$;

create or replace function private.dispute_event(p_dispute uuid, p_actor public.actor_kind, p_actor_id uuid, p_action text, p_note text)
returns void language sql security definer set search_path = '' as $$
  insert into public.dispute_events (dispute_id, actor_kind, action, note) values (p_dispute, p_actor, p_action, left(p_note, 1000));
  insert into public.audit_log (actor_kind, actor_id, action, entity_type, entity_id, details)
  values (p_actor, p_actor_id, 'dispute.' || p_action, 'dispute', p_dispute::text, jsonb_build_object('note', left(p_note, 1000)));
$$;
revoke all on function private.dispute_event(uuid, public.actor_kind, uuid, text, text) from public;

/** A player disputes their own recorded day. Raises a plain-language error when it isn't allowed. */
create or replace function public.open_dispute(p_membership uuid, p_day smallint, p_reason text, p_evidence text[])
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  m public.memberships;
  ch public.challenges;
  r public.day_results;
  new_id uuid;
  u text;
begin
  select * into m from public.memberships where id = p_membership;
  if not found or m.profile_id is distinct from uid then
    raise exception 'You can only dispute your own days.' using errcode = '42501';
  end if;
  select * into ch from public.challenges where id = m.challenge_id;
  if ch.pool_state <> 'open' then
    raise exception 'This challenge is already %, so its days can no longer change.', ch.pool_state using errcode = '22023';
  end if;
  if now() >= private.dispute_end(ch) then
    raise exception 'The dispute window closed on % UTC.', to_char(private.dispute_end(ch) at time zone 'UTC', 'YYYY-MM-DD HH24:MI') using errcode = '22023';
  end if;
  select * into r from public.day_results where membership_id = p_membership and day = p_day;
  if not found or r.onchain_at is null then
    raise exception 'Day % has no recorded result yet. You can dispute it once it is recorded on-chain.', p_day + 1 using errcode = '22023';
  end if;
  if r.result = 'verified' then
    raise exception 'Day % is already verified.', p_day + 1 using errcode = '22023';
  end if;
  if char_length(coalesce(btrim(p_reason), '')) < 20 then
    raise exception 'Explain what happened in at least 20 characters.' using errcode = '22023';
  end if;
  foreach u in array coalesce(p_evidence, '{}') loop
    if u !~ '^https://[^\s]{4,}$' or char_length(u) > 500 then
      raise exception 'Evidence links must be https:// links (at most 5).' using errcode = '22023';
    end if;
  end loop;
  if (select count(*) from public.disputes d where d.membership_id = p_membership and d.day = p_day) >= 2 then
    raise exception 'Day % was already disputed twice.', p_day + 1 using errcode = '22023';
  end if;
  insert into public.disputes (membership_id, day, opened_by, reason, evidence_urls, previous_result, previous_hash)
  values (p_membership, p_day, uid, btrim(p_reason), coalesce(p_evidence, '{}'), r.result, r.evidence_hash)
  returning disputes.id into new_id;
  perform private.dispute_event(new_id, 'user', uid, 'opened', null);
  return new_id;
exception
  when unique_violation then
    raise exception 'Day % already has an open dispute.', p_day + 1 using errcode = '23505';
end $$;
revoke all on function public.open_dispute(uuid, smallint, text, text[]) from public, anon;
grant execute on function public.open_dispute(uuid, smallint, text, text[]) to authenticated;

/** Admin decision. Approving queues the on-chain upgrade for the worker (within a minute). */
create or replace function public.review_dispute(p_dispute uuid, p_approve boolean, p_note text)
returns public.dispute_status
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  d public.disputes;
  ch public.challenges;
  outcome public.dispute_status;
begin
  if not private.is_admin(uid) then
    raise exception 'Only admins can review disputes.' using errcode = '42501';
  end if;
  select * into d from public.disputes where id = p_dispute for update;
  if not found then raise exception 'Dispute not found.' using errcode = 'P0002'; end if;
  if d.status <> 'open' then
    raise exception 'This dispute was already %.', d.status using errcode = '22023';
  end if;
  if char_length(coalesce(btrim(p_note), '')) < 5 then
    raise exception 'Add a short note for the player (at least 5 characters).' using errcode = '22023';
  end if;
  select c.* into ch from public.challenges c join public.memberships m on m.challenge_id = c.id where m.id = d.membership_id;
  outcome := case when not p_approve then 'rejected'::public.dispute_status
               when now() >= private.dispute_end(ch) or ch.pool_state <> 'open' then 'expired'::public.dispute_status
               else 'approved'::public.dispute_status end;
  update public.disputes set status = outcome, reviewer_id = uid, reviewed_at = now(), review_note = btrim(p_note),
         error = case when outcome = 'expired' then 'The dispute window closed before the review.' end, updated_at = now()
   where id = p_dispute;
  perform private.dispute_event(p_dispute, 'admin', uid, outcome::text, btrim(p_note));
  return outcome;
end $$;
revoke all on function public.review_dispute(uuid, boolean, text) from public, anon;
grant execute on function public.review_dispute(uuid, boolean, text) to authenticated;

/**
 * Worker: the upgrade is on-chain (p_tx; null when the chain already had it). The dispute receipt
 * replaces the day's receipt and the day becomes verified, in one transaction.
 */
create or replace function public.resolve_dispute(p_dispute uuid, p_tx text, p_receipt text, p_hash text)
returns void
language plpgsql security definer set search_path = '' as $$
declare d public.disputes;
begin
  select * into d from public.disputes where id = p_dispute for update;
  if not found or d.status <> 'approved' then return; end if;   -- idempotent
  update public.day_receipts set engine = p_receipt::jsonb ->> 'engine', receipt = p_receipt, evidence_hash = p_hash
   where membership_id = d.membership_id and day = d.day;
  update public.day_results set result = 'verified', source = 'dispute', evidence_hash = p_hash, record_tx = coalesce(p_tx, record_tx), onchain_at = now()
   where membership_id = d.membership_id and day = d.day;
  update public.disputes set status = 'resolved', resolution_tx = p_tx, resolved_at = now(), error = null, updated_at = now() where id = p_dispute;
  perform private.dispute_event(p_dispute, 'worker', null, 'resolved', coalesce('Recorded on-chain: ' || p_tx, 'Already verified on-chain.'));
end $$;

/** Worker: an approved dispute could not be applied (window closed: expired; anything else: failed). */
create or replace function public.close_dispute(p_dispute uuid, p_status public.dispute_status, p_error text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('expired', 'failed') then
    raise exception 'close_dispute: % is not a closing status', p_status using errcode = '22023';
  end if;
  update public.disputes set status = p_status, error = left(p_error, 500), updated_at = now() where id = p_dispute and status = 'approved';
  if found then perform private.dispute_event(p_dispute, 'worker', null, p_status::text, p_error); end if;
end $$;
revoke all on function public.resolve_dispute(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.close_dispute(uuid, public.dispute_status, text) from public, anon, authenticated;
grant execute on function public.resolve_dispute(uuid, text, text, text) to service_role;
grant execute on function public.close_dispute(uuid, public.dispute_status, text) to service_role;

-- The crank picks approved disputes up first (before settling): reason "dispute". It also closes
-- approved disputes of challenges that already settled (expired).
create or replace function public.verification_work(max_rows integer default 10)
returns table (challenge_id uuid, address text, reason text)
language sql stable security definer set search_path = '' as $$
  with c as (
    select ch.*,
      extract(epoch from now()) as now_s,
      extract(epoch from ch.start_at) as start_s,
      extract(epoch from ch.start_at) + ch.num_days::double precision * ch.day_length_secs as end_s
    from public.challenges ch
    where ch.onchain_address is not null
  ),
  w as (
    select c.id, c.onchain_address, c.start_s,
      case
        when exists (
          select 1 from public.disputes d join public.memberships m on m.id = d.membership_id
           where m.challenge_id = c.id and d.status = 'approved') then 'dispute'
        when c.pool_state = 'open' and now() >= c.join_deadline_at and c.participant_count < c.min_participants then 'cancel'
        when c.pool_state = 'open' and c.now_s >= c.end_s + c.verify_window_secs + c.dispute_window_secs then 'settle'
        when c.pool_state = 'open'
          and c.now_s >= c.start_s + c.day_length_secs
          and c.now_s < c.end_s + c.verify_window_secs
          and exists (
            select 1 from public.memberships m
            where m.challenge_id = c.id and m.status = 'active'
              and (select count(*) from public.day_results d where d.membership_id = m.id and d.onchain_at is not null)
                  < (select count(*) from generate_series(0, c.num_days - 1) g(day)
                      where c.start_s + (g.day + 1) * c.day_length_secs
                            + private.record_delay_secs(c.day_length_secs, c.end_s + c.verify_window_secs - (c.start_s + (g.day + 1) * c.day_length_secs))
                            <= c.now_s)
          ) then 'record'
        when c.pool_state in ('settled', 'cancelled') and c.payouts_done_at is null then 'payout'
      end as reason
    from c
  )
  select w.id, w.onchain_address, w.reason from w where w.reason is not null
  order by w.start_s
  limit greatest(1, least(max_rows, 50));
$$;
