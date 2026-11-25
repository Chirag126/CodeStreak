-- Fix: admin_overview's PL/pgSQL variable `result` clashed with day_results.result
-- ("column reference \"result\" is ambiguous"), so the Control Center overview failed to load.
-- Same function, variable renamed. Grants are kept by CREATE OR REPLACE.
/** Platform overview: totals and 30-day daily series (real rows only). */
create or replace function public.admin_overview(p_actor uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb;
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
  ) into v_out;
  return v_out;
end $$;

