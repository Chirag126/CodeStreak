-- Phase 34: soulbound survivor badges (Token-2022 NonTransferable + on-mint metadata).
--
-- The chain decides who gets a badge (mint_badge only accepts a finalized Survived participant,
-- and the mint is a PDA of the participant, so there is one badge per player per challenge ever).
-- The worker mints it after settlement and mirrors it here; this file is only the mirror:
--   * badge type "survivor";
--   * challenges.badges_checked_at: the last time the worker tried, so a failing mint (e.g. the
--     program on devnet not upgraded yet) is retried every 10 minutes, not every minute;
--   * verification_work reason "badge";
--   * record_badge(): service role only, refuses non-survivors and a second, different mint;
--   * badge_metadata(): what the public JSON behind the badge's on-chain URI is built from.

insert into public.badge_types (code, name, description)
values ('survivor', 'Survivor', 'Kept the streak every day of a CodeStreak challenge. A soulbound Token-2022 badge on Solana devnet: it cannot be transferred or sold.')
on conflict (code) do nothing;

alter table public.challenges add column if not exists badges_checked_at timestamptz;

-- Same as Phase 31, plus reason "badge" (lowest priority: after payouts).
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
        when c.pool_state = 'settled'
          and (c.badges_checked_at is null or c.badges_checked_at < now() - interval '10 minutes')
          and exists (
            select 1 from public.memberships m
             where m.challenge_id = c.id and m.status = 'survived'
               and not exists (select 1 from public.badges b
                                where b.challenge_id = c.id and b.profile_id = m.profile_id
                                  and b.badge_code = 'survivor' and b.mint_address is not null)
          ) then 'badge'
      end as reason
    from c
  )
  select w.id, w.onchain_address, w.reason from w where w.reason is not null
  order by w.start_s
  limit greatest(1, least(max_rows, 50));
$$;

/**
 * Mirrors one minted badge. Idempotent: the same mint again changes nothing. Refuses a member who
 * did not survive, and a different mint for a badge that already has one (the chain allows exactly
 * one badge mint per participant, so a second address means something is wrong).
 */
create or replace function public.record_badge(p_challenge uuid, p_wallet text, p_mint text, p_tx text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare m record;
declare existing record;
declare badge uuid;
begin
  select id, profile_id, status into m from public.memberships where challenge_id = p_challenge and wallet_address = p_wallet;
  if m.id is null then
    raise exception 'record_badge: % is not a member of challenge %', p_wallet, p_challenge using errcode = 'P0002';
  end if;
  if m.status <> 'survived' then
    raise exception 'record_badge: % did not survive challenge % (status %), so no badge', p_wallet, p_challenge, m.status using errcode = 'P0001';
  end if;
  select id, mint_address into existing from public.badges
   where profile_id = m.profile_id and badge_code = 'survivor' and challenge_id = p_challenge;
  if existing.id is not null and existing.mint_address is not null then
    if existing.mint_address::text <> p_mint then
      raise exception 'record_badge: badge % already has mint %, not %', existing.id, existing.mint_address, p_mint using errcode = 'P0001';
    end if;
    return existing.id;
  end if;
  if existing.id is not null then
    update public.badges set mint_address = p_mint, mint_tx = p_tx where id = existing.id returning id into badge;
  else
    insert into public.badges (profile_id, badge_code, challenge_id, mint_address, mint_tx)
    values (m.profile_id, 'survivor', p_challenge, p_mint, p_tx) returning id into badge;
  end if;
  insert into public.audit_log (actor_kind, action, entity_type, entity_id, details)
  values ('worker', 'badge.minted', 'badge', badge::text, jsonb_build_object('challenge', p_challenge, 'wallet', p_wallet, 'mint', p_mint, 'tx', p_tx));
  return badge;
end $$;

/**
 * The badge's off-chain metadata (Metaplex-style JSON fields), looked up by the on-chain
 * Participant address that the badge URI ends with. Only for survivors; null otherwise. Private
 * challenges are not named.
 */
create or replace function public.badge_metadata(p_participant text)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'username', p.username,
    'wallet', m.wallet_address,
    'challenge_title', case when c.visibility = 'public' then c.title else 'a private challenge' end,
    'challenge_address', case when c.visibility = 'public' then c.onchain_address end,
    'num_days', c.num_days,
    'finished_at', c.start_at + make_interval(secs => c.num_days::double precision * c.day_length_secs),
    'mint', b.mint_address,
    'mint_tx', b.mint_tx
  )
  from public.memberships m
  join public.challenges c on c.id = m.challenge_id
  join public.profiles p on p.id = m.profile_id
  left join public.badges b on b.challenge_id = c.id and b.profile_id = m.profile_id and b.badge_code = 'survivor'
  where m.participant_address = p_participant and m.status = 'survived'
  limit 1;
$$;

revoke all on function public.verification_work(integer) from public, anon, authenticated;
grant execute on function public.verification_work(integer) to service_role;
revoke all on function public.record_badge(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_badge(uuid, text, text, text) to service_role;
-- Read by the web app's metadata route on the server (service role), like every other definer.
revoke all on function public.badge_metadata(text) from public, anon, authenticated;
grant execute on function public.badge_metadata(text) to service_role;

-- Badges link to the badge page, not the dashboard.
create or replace function private.notify_badge() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(new.profile_id, 'badge', 'You earned a badge: ' || coalesce((select name from public.badge_types where code = new.badge_code), new.badge_code),
    'A soulbound token in your wallet. It cannot be transferred.', '/dashboard/badges', new.challenge_id, 'badge:' || new.id);
  return null;
end $$;
revoke all on function private.notify_badge() from public;
