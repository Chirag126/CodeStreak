-- Phase 18 - one row per challenge with what lists and detail pages need: end time, pool size,
-- members, players still in, survivors, finalized. security_invoker: the caller's RLS applies,
-- so private groups appear only to their creator, members and invitees.

create view public.challenge_overview with (security_invoker = true) as
select
  c.id,
  c.title,
  c.description,
  c.visibility,
  c.token,
  c.mint,
  c.onchain_address,
  c.creator_id,
  c.buy_in,
  c.start_at,
  c.join_deadline_at,
  c.start_at + make_interval(secs => c.num_days::double precision * c.day_length_secs) as end_at,
  c.day_length_secs,
  c.num_days,
  c.min_participants,
  c.max_participants,
  c.max_shields,
  c.shield_price,
  c.shield_grace_secs,
  c.rules,
  c.is_demo,
  c.pool_state,
  c.participant_count,
  c.total_stake,
  c.total_sponsor,
  c.total_shield,
  (c.total_stake + c.total_sponsor + c.total_shield) as pool_total,
  c.created_at,
  c.updated_at,
  coalesce(s.members, 0) as members,
  coalesce(s.still_in, 0) as still_in,
  coalesce(s.survived, 0) as survived,
  coalesce(s.finalized, 0) as finalized
from public.challenges c
left join lateral (
  select
    count(*) as members,
    -- still in: not finalized as failed/voided, and no failed day that isn't covered by a Shield
    count(*) filter (
      where m.status in ('active', 'survived')
        and not exists (
          select 1 from public.day_results d
          where d.membership_id = m.id and d.result = 'failed'
            and not exists (select 1 from public.shields sh where sh.membership_id = m.id and sh.day = d.day)
        )
    ) as still_in,
    count(*) filter (where m.status = 'survived') as survived,
    count(*) filter (where m.status <> 'active') as finalized
  from public.memberships m
  where m.challenge_id = c.id
) s on true;

grant select on public.challenge_overview to anon, authenticated;

-- List queries filter on these.
create index challenges_join_deadline on public.challenges (join_deadline_at);
create index challenges_pool_state on public.challenges (pool_state);
