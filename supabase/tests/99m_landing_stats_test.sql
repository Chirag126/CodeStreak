-- Phase 40: the landing page's numbers equal the plain database queries (no padding, no estimates).
\set QUIET on
set client_min_messages = warning;

do $$
declare s jsonb := public.landing_stats();
declare total_v bigint;
begin
  if (s->>'players')::bigint <> (select count(*) from public.profiles where username is not null) then raise exception 'players mismatch'; end if;
  if (s->>'challenges')::bigint <> (select count(*) from public.challenges where onchain_address is not null) then raise exception 'challenges mismatch'; end if;
  if (s->>'verified_days')::bigint <> (select count(*) from public.day_results where result = 'verified' and onchain_at is not null) then raise exception 'verified days mismatch'; end if;
  if (s->>'badges')::bigint <> (select count(*) from public.badges where mint_address is not null) then raise exception 'badges mismatch'; end if;
  if jsonb_array_length(s->'grid') <> 84 then raise exception 'grid must be 12 weeks'; end if;
  -- The grid's verified cells add up to the recorded results of the same 84 days.
  select coalesce(sum((g->>'verified')::bigint), 0) into total_v from jsonb_array_elements(s->'grid') g;
  if total_v <> (select count(*) from public.day_results where result = 'verified' and onchain_at is not null
                   and (onchain_at at time zone 'UTC')::date > (now() at time zone 'UTC')::date - 84) then
    raise exception 'grid mismatch';
  end if;
  -- Browsers can't call it.
  if has_function_privilege('anon', 'public.landing_stats()', 'execute') or has_function_privilege('authenticated', 'public.landing_stats()', 'execute') then
    raise exception 'landing_stats must be server-only';
  end if;
end $$;

-- Hand-computed: one new onboarded player moves "players" by exactly one; one without a username doesn't.
insert into auth.users (id, email) values ('dd000000-0000-0000-0000-0000000000d1', 'land1@example.com'), ('dd000000-0000-0000-0000-0000000000d2', 'land2@example.com');
do $$
declare before bigint := (select count(*) from public.profiles where username is not null);
begin
  update public.profiles set username = 'land_one' where id = 'dd000000-0000-0000-0000-0000000000d1';
  if (public.landing_stats()->>'players')::bigint <> before + 1 then raise exception 'players did not move by exactly one'; end if;
end $$;

\echo 'landing stats: ok'
