-- Phase 40: the public landing page's numbers, in ONE place so the page can't drift from the data.
-- Every figure is a plain count over real rows; nothing is estimated or padded. Read by the web
-- server (service role) only; it exposes aggregates, never a name, address or private-group detail.
create or replace function public.landing_stats() returns jsonb
language sql stable security definer set search_path = '' as $$
  with days as (
    select generate_series((now() at time zone 'UTC')::date - 83, (now() at time zone 'UTC')::date, interval '1 day')::date as d
  )
  select jsonb_build_object(
    -- Accounts that finished onboarding (deleted accounts lose their username).
    'players', (select count(*) from public.profiles where username is not null),
    -- Challenges that exist on-chain (public and private alike: counts only).
    'challenges', (select count(*) from public.challenges where onchain_address is not null),
    -- Day results the verifier recorded on Solana.
    'verified_days', (select count(*) from public.day_results where result = 'verified' and onchain_at is not null),
    -- Soulbound survivor badges minted.
    'badges', (select count(*) from public.badges where mint_address is not null),
    -- Hero grid: per UTC day (last 12 weeks), results recorded on-chain, all players together.
    'grid', (
      select jsonb_agg(jsonb_build_object(
        'date', days.d,
        'verified', (select count(*) from public.day_results r where r.result = 'verified' and r.onchain_at is not null and (r.onchain_at at time zone 'UTC')::date = days.d),
        'failed', (select count(*) from public.day_results r where r.result = 'failed' and r.onchain_at is not null and (r.onchain_at at time zone 'UTC')::date = days.d)
      ) order by days.d)
      from days
    )
  );
$$;
revoke all on function public.landing_stats() from public, anon, authenticated;
grant execute on function public.landing_stats() to service_role;
