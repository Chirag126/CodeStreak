-- Phase 28 - Verification job: records every finished challenge day on-chain, then cancels,
-- finalizes, settles and pays out, without anyone pressing a button.
--
--   pg_cron (every minute) -> wake the worker only if public.verification_has_work()
--   worker /jobs/verify    -> for each challenge with work, under a lease (one run at a time):
--        record  : day results -> receipt -> save_day_result (DB) -> record_verification (chain) -> mark_day_recorded
--        cancel  : joining closed with too few players -> cancel_pool
--        settle  : dispute window over -> finalize_participant (each) -> settle_challenge
--        payout  : rewards and refunds are pushed to each wallet's token account (claims are
--                  permissionless; the verifier pays the fees). SOL arrives as Wrapped SOL.
-- The chain is the source of truth: the worker re-reads it before every transaction, so a
-- duplicate or overlapping run never sends a second transaction for the same thing.

-- When all automatic payouts of a settled/cancelled challenge are done.
alter table public.challenges add column payouts_done_at timestamptz;
-- When a day result is known to be on-chain (its transaction, or found on-chain by a later run).
alter table public.day_results add column onchain_at timestamptz;

/**
 * How long after a day ends its result is recorded: long enough for late pushes and for the
 * LeetCode list to show last-minute solves (a quarter of a day, from 1 to 45 minutes), but never
 * so late that the verification window closes first (2 minutes of margin). Mirrored in
 * apps/worker/src/verify/schedule.ts.
 */
create or replace function private.record_delay_secs(day_length_secs integer, secs_until_verify_end double precision)
returns double precision
language sql immutable set search_path = '' as $$
  select least(least(2700, greatest(60, day_length_secs / 4))::double precision, greatest(0, secs_until_verify_end - 120));
$$;

-- The lease: at most one scheduled run per challenge at a time.
create unique index verification_runs_one_scheduled on public.verification_runs (challenge_id)
  where status = 'running' and triggered_by = 'scheduled';

/**
 * Challenges with work for the worker, oldest first:
 *   cancel  - joining closed with fewer than the minimum players;
 *   record  - a finished day (within the verification window) lacks an on-chain result for a player;
 *   settle  - the dispute window is over and the pool is still open;
 *   payout  - settled or cancelled, automatic payouts not done yet.
 */
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

create or replace function public.verification_has_work() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.verification_work(1));
$$;

/** Takes the lease for a challenge (null if another run holds it). Stale leases (10 min) expire. */
create or replace function public.begin_verification_run(p_challenge uuid, p_day smallint default 0)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare run uuid;
begin
  update public.verification_runs
     set status = 'failed', finished_at = now(), error = 'lease expired (the run stopped without finishing)'
   where challenge_id = p_challenge and status = 'running' and triggered_by = 'scheduled'
     and started_at < now() - interval '10 minutes';
  insert into public.verification_runs (challenge_id, day, triggered_by)
  values (p_challenge, greatest(0, least(p_day, 59)), 'scheduled')
  on conflict do nothing
  returning id into run;
  return run;
end $$;

create or replace function public.finish_verification_run(p_run uuid, p_status public.run_status, p_checked integer, p_error text)
returns void
language sql security definer set search_path = '' as $$
  update public.verification_runs
     set status = p_status, finished_at = now(), checked_count = greatest(0, p_checked), error = left(p_error, 2000)
   where id = p_run and status = 'running';
$$;

/**
 * Saves a day's final result with its receipt and evidence, in one transaction. Once saved, a day
 * is never recomputed: a retry gets the stored result and hash back (cached = true), so the chain
 * always receives exactly the hash the receipt was sealed with.
 */
create or replace function public.save_day_result(
  p_membership uuid, p_day smallint, p_result public.day_result, p_hash text, p_engine text, p_receipt text,
  p_evidence jsonb, p_run uuid
)
returns table (result public.day_result, evidence_hash text, record_tx text, cached boolean)
language plpgsql security definer set search_path = '' as $$
declare existing public.day_results;
begin
  select * into existing from public.day_results d where d.membership_id = p_membership and d.day = p_day for update;
  if found then
    return query select existing.result, existing.evidence_hash, existing.record_tx::text, true;
    return;
  end if;

  insert into public.day_results (membership_id, day, result, source, evidence_count, evidence_hash)
  values (p_membership, p_day, p_result, 'worker', coalesce(jsonb_array_length(p_evidence), 0), p_hash);
  insert into public.day_receipts (membership_id, day, engine, receipt, evidence_hash)
  values (p_membership, p_day, p_engine, p_receipt, p_hash);

  -- The final evidence replaces the day's preview evidence (from "Check now").
  delete from public.evidence e where e.membership_id = p_membership and e.day = p_day;
  insert into public.evidence (membership_id, run_id, day, provider, kind, external_id, occurred_at, diff_hash, counted, reason, details)
  select p_membership, p_run, p_day, x.provider, x.kind, x.external_id, coalesce(x.occurred_at, now()), x.diff_hash, x.counted, x.reason, coalesce(x.details, '{}')
  from jsonb_to_recordset(coalesce(p_evidence, '[]')) as x(
    provider public.provider, kind public.evidence_kind, external_id text, occurred_at timestamptz,
    diff_hash text, counted boolean, reason text, details jsonb)
  on conflict (membership_id, provider, external_id) do nothing;

  insert into public.audit_log (actor_kind, action, entity_type, entity_id, details)
  values ('worker', 'verification.day_saved', 'membership', p_membership::text,
          jsonb_build_object('day', p_day, 'result', p_result, 'evidence_hash', p_hash, 'run', p_run));
  return query select p_result, p_hash, null::text, false;
end $$;

/**
 * Mirrors a day result confirmed on-chain (idempotent). p_tx is the record_verification
 * transaction, or null when a later run found the result already on-chain.
 */
create or replace function public.mark_day_recorded(p_membership uuid, p_day smallint, p_tx text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.day_results set record_tx = coalesce(record_tx, p_tx), onchain_at = now()
   where membership_id = p_membership and day = p_day and onchain_at is null;
  if found then
    insert into public.audit_log (actor_kind, action, entity_type, entity_id, details)
    values ('worker', 'verification.day_recorded', 'membership', p_membership::text, jsonb_build_object('day', p_day, 'tx', p_tx));
  end if;
end $$;

/**
 * Mirrors the chain's pool state and each finalized player's outcome. Called by the worker after
 * cancel_pool, finalize_participant and settle_challenge (and whenever it finds the chain ahead).
 * p_members: [{ "wallet": base58, "status": "survived" | "failed" | "voided" }].
 */
create or replace function public.mirror_pool_state(p_challenge uuid, p_state public.pool_state, p_members jsonb)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.challenges set pool_state = p_state where id = p_challenge and pool_state = 'open' and p_state <> 'open';
  if found then
    insert into public.audit_log (actor_kind, action, entity_type, entity_id, details)
    values ('worker', 'challenge.' || p_state::text, 'challenge', p_challenge::text, '{}');
  end if;
  update public.memberships m set status = x.status, finalized_at = now()
    from jsonb_to_recordset(coalesce(p_members, '[]')) as x(wallet text, status public.membership_status)
   where m.challenge_id = p_challenge and m.wallet_address = x.wallet and x.status <> 'active' and m.finalized_at is null;
end $$;

/**
 * Mirrors one confirmed payout (reward, refund or sponsor refund): the receipt, the membership's
 * payout, and the audit entry. Idempotent on the transaction signature. p_tx is null when a later
 * attempt found the payout already made (its confirmation was lost): the membership is still
 * marked paid, without a receipt.
 */
create or replace function public.record_payout(p_challenge uuid, p_wallet text, p_kind public.receipt_kind, p_amount numeric, p_tx text)
returns void
language plpgsql security definer set search_path = '' as $$
declare prof uuid;
declare first_time boolean;
begin
  if p_kind not in ('reward', 'refund', 'sponsor_refund') then
    raise exception 'record_payout: % is not a payout', p_kind using errcode = '22023';
  end if;
  if p_kind = 'sponsor_refund' then
    select s.sponsor_id into prof from public.sponsorships s
     where s.challenge_id = p_challenge and s.sponsor_wallet = p_wallet and s.sponsor_id is not null limit 1;
    first_time := p_tx is not null;
  else
    update public.memberships set claimed_at = now(), payout = p_amount
     where challenge_id = p_challenge and wallet_address = p_wallet and claimed_at is null
     returning profile_id into prof;
    first_time := found;
    if not first_time then
      select m.profile_id into prof from public.memberships m where m.challenge_id = p_challenge and m.wallet_address = p_wallet;
    end if;
  end if;
  if p_tx is not null then
    insert into public.receipts (challenge_id, profile_id, wallet, kind, amount, tx_signature)
    values (p_challenge, prof, p_wallet, p_kind, p_amount, p_tx)
    on conflict (tx_signature) do nothing;
    first_time := found;
  end if;
  if first_time then
    insert into public.audit_log (actor_kind, action, entity_type, entity_id, details)
    values ('worker', 'payout.' || p_kind::text, 'challenge', p_challenge::text,
            jsonb_build_object('wallet', p_wallet, 'amount', p_amount::text, 'tx', p_tx));
  end if;
end $$;

revoke all on function public.verification_work(integer) from public, anon, authenticated;
revoke all on function public.mirror_pool_state(uuid, public.pool_state, jsonb) from public, anon, authenticated;
revoke all on function public.record_payout(uuid, text, public.receipt_kind, numeric, text) from public, anon, authenticated;
revoke all on function private.record_delay_secs(integer, double precision) from public, anon, authenticated;
revoke all on function public.verification_has_work() from public, anon, authenticated;
revoke all on function public.begin_verification_run(uuid, smallint) from public, anon, authenticated;
revoke all on function public.finish_verification_run(uuid, public.run_status, integer, text) from public, anon, authenticated;
revoke all on function public.save_day_result(uuid, smallint, public.day_result, text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.mark_day_recorded(uuid, smallint, text) from public, anon, authenticated;
grant execute on function public.verification_work(integer) to service_role;
grant execute on function public.mirror_pool_state(uuid, public.pool_state, jsonb) to service_role;
grant execute on function public.record_payout(uuid, text, public.receipt_kind, numeric, text) to service_role;
grant execute on function public.verification_has_work() to service_role;
grant execute on function public.begin_verification_run(uuid, smallint) to service_role;
grant execute on function public.finish_verification_run(uuid, public.run_status, integer, text) to service_role;
grant execute on function public.save_day_result(uuid, smallint, public.day_result, text, text, text, jsonb, uuid) to service_role;
grant execute on function public.mark_day_recorded(uuid, smallint, text) to service_role;

-- Every minute, but the worker is woken only when there is something to do (free plan friendly).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('codestreak-verify', '* * * * *',
      $job$select private.wake_worker('verify') where public.verification_has_work()$job$);
  else
    raise notice 'pg_cron not available: verification schedule not created (expected outside Supabase)';
  end if;
end $$;
