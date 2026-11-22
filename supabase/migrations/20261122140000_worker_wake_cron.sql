-- Phase 14 - wake the Render worker from Supabase (Render's free plan has no cron jobs).
--
-- pg_cron runs private.wake_worker() on a schedule; it POSTs to the worker's /jobs/wake with the
-- shared secret through pg_net. The worker URL and secret live in Supabase Vault (never in this
-- file or in the repo):
--   worker_url         e.g. https://codestreak-worker.onrender.com
--   worker_job_secret  the same value as WORKER_JOB_SECRET on the Render worker
--
-- Every 30 minutes: the free instance sleeps after ~15 idle minutes, so it is awake about half the
-- time, which keeps the workspace inside Render's 750 free instance-hours a month. Later phases
-- tighten the schedule around challenge day boundaries.

create or replace function private.wake_worker(job text default 'wake') returns bigint
language plpgsql set search_path = '' as $$
declare
  base_url text;
  secret text;
begin
  if job !~ '^[a-z0-9-]{1,64}$' then
    raise exception 'invalid job name %', job;
  end if;
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'worker_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'worker_job_secret';
  if base_url is null or secret is null then
    raise notice 'wake_worker: worker_url / worker_job_secret not set in Vault; skipping';
    return null;
  end if;
  -- A sleeping free instance takes up to about a minute to start, so allow a long timeout.
  return net.http_post(
    url := rtrim(base_url, '/') || '/jobs/' || job,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret, 'Content-Type', 'application/json'),
    timeout_milliseconds := 90000
  );
end $$;

revoke all on function private.wake_worker(text) from public, anon, authenticated;

-- Extensions and the schedule exist only on Supabase (plain Postgres in CI has neither).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron')
     and exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('codestreak-wake-worker', '*/30 * * * *', $job$select private.wake_worker('wake')$job$);
  else
    raise notice 'pg_cron / pg_net not available: schedule not created (expected outside Supabase)';
  end if;
end $$;
