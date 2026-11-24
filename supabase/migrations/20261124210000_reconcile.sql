-- Phase 29 - Crank and reconcile: the chain is the source of truth; the database is a mirror.
--
-- public.reconcile_challenge() takes one challenge as the worker read it from devnet (the
-- account, its participants and their day bitmasks) and fixes every place the database drifted:
--   challenge : missing row (created outside the app), pool state, player count, totals,
--               payouts marked done while something is still owed
--   members   : missing memberships (joined outside the app with a linked wallet), status,
--               deposit, participant address, finalized / claimed times
--   days      : on-chain flag of each day result (set when the chain has it, cleared when it doesn't,
--               so the verification job records it again)
-- Every fix is written to the audit log with the database value and the chain value. A call that
-- finds nothing to fix changes nothing and logs nothing.

create or replace function public.reconcile_challenge(p_chain jsonb, p_participants jsonb, p_payouts_pending boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  ch public.challenges;
  added boolean := false;
  changes jsonb := '[]';
  warnings jsonb := '[]';
  diff jsonb := '{}';
  p jsonb;
  m public.memberships;
  prof uuid;
  member_diff jsonb;
  d record;
  chain_days jsonb;
  n integer;
begin
  select * into ch from public.challenges where onchain_address = p_chain ->> 'onchain_address' for update;

  -- A challenge created outside the app (devnet scripts, the demo seed): add it.
  if not found then
    select w.profile_id into prof from public.wallets w where w.address = p_chain ->> 'creator';
    insert into public.challenges (
      creator_id, title, visibility, token, onchain_address, onchain_challenge_id, mint, vault,
      buy_in, start_at, day_length_secs, num_days, join_deadline_at, min_participants, max_participants,
      shield_price, max_shields, shield_grace_secs, verify_window_secs, dispute_window_secs,
      rules, rules_hash, pool_state, participant_count, total_stake, total_sponsor, total_shield)
    values (
      prof,
      case when (p_chain ->> 'day_length_secs')::integer < 86400 then 'Demo challenge ' else 'Challenge ' end || left(p_chain ->> 'onchain_address', 4),
      (p_chain ->> 'visibility')::public.challenge_visibility, (p_chain ->> 'token')::public.stake_token,
      p_chain ->> 'onchain_address', (p_chain ->> 'onchain_challenge_id')::numeric, p_chain ->> 'mint', p_chain ->> 'vault',
      (p_chain ->> 'buy_in')::numeric, (p_chain ->> 'start_at')::timestamptz, (p_chain ->> 'day_length_secs')::integer,
      (p_chain ->> 'num_days')::smallint, (p_chain ->> 'join_deadline_at')::timestamptz,
      (p_chain ->> 'min_participants')::smallint, (p_chain ->> 'max_participants')::smallint,
      (p_chain ->> 'shield_price')::numeric, (p_chain ->> 'max_shields')::smallint, (p_chain ->> 'shield_grace_secs')::integer,
      (p_chain ->> 'verify_window_secs')::integer, (p_chain ->> 'dispute_window_secs')::integer,
      jsonb_build_object('source', 'chain', 'note', 'Created outside the app; the on-chain rules hash is authoritative.'),
      p_chain ->> 'rules_hash', (p_chain ->> 'pool_state')::public.pool_state, (p_chain ->> 'participant_count')::smallint,
      (p_chain ->> 'total_stake')::numeric, (p_chain ->> 'total_sponsor')::numeric, (p_chain ->> 'total_shield')::numeric)
    returning * into ch;
    added := true;
    insert into public.audit_log (actor_kind, action, entity_type, entity_id, details)
    values ('worker', 'reconcile.challenge_added', 'challenge', ch.id::text, jsonb_build_object('address', ch.onchain_address));
  else
    -- Mutable state: pool, players, totals.
    if ch.pool_state::text <> p_chain ->> 'pool_state' then
      diff := diff || jsonb_build_object('pool_state', jsonb_build_object('db', ch.pool_state, 'chain', p_chain ->> 'pool_state'));
    end if;
    if ch.participant_count <> (p_chain ->> 'participant_count')::integer then
      diff := diff || jsonb_build_object('participant_count', jsonb_build_object('db', ch.participant_count, 'chain', (p_chain ->> 'participant_count')::integer));
    end if;
    if ch.total_stake <> (p_chain ->> 'total_stake')::numeric then
      diff := diff || jsonb_build_object('total_stake', jsonb_build_object('db', ch.total_stake::text, 'chain', p_chain ->> 'total_stake'));
    end if;
    if ch.total_sponsor <> (p_chain ->> 'total_sponsor')::numeric then
      diff := diff || jsonb_build_object('total_sponsor', jsonb_build_object('db', ch.total_sponsor::text, 'chain', p_chain ->> 'total_sponsor'));
    end if;
    if ch.total_shield <> (p_chain ->> 'total_shield')::numeric then
      diff := diff || jsonb_build_object('total_shield', jsonb_build_object('db', ch.total_shield::text, 'chain', p_chain ->> 'total_shield'));
    end if;
    if diff <> '{}' then
      update public.challenges set
        pool_state = (p_chain ->> 'pool_state')::public.pool_state,
        participant_count = (p_chain ->> 'participant_count')::smallint,
        total_stake = (p_chain ->> 'total_stake')::numeric,
        total_sponsor = (p_chain ->> 'total_sponsor')::numeric,
        total_shield = (p_chain ->> 'total_shield')::numeric
      where id = ch.id;
      changes := changes || jsonb_build_array('challenge: ' || (select string_agg(k, ', ') from jsonb_object_keys(diff) k));
      insert into public.audit_log (actor_kind, action, entity_type, entity_id, details)
      values ('worker', 'reconcile.challenge_fixed', 'challenge', ch.id::text, diff);
    end if;
  end if;

  -- Payouts marked done while the chain still owes someone: reopen them for the job.
  if p_payouts_pending and ch.payouts_done_at is not null then
    update public.challenges set payouts_done_at = null where id = ch.id;
    changes := changes || jsonb_build_array('payouts reopened');
    insert into public.audit_log (actor_kind, action, entity_type, entity_id, details)
    values ('worker', 'reconcile.payouts_reopened', 'challenge', ch.id::text, '{}');
  end if;

  -- Members.
  for p in select * from jsonb_array_elements(coalesce(p_participants, '[]')) loop
    select * into m from public.memberships x
     where x.challenge_id = ch.id and (x.participant_address = p ->> 'address' or x.wallet_address = p ->> 'wallet')
     for update;
    if not found then
      -- Joined outside the app: mirror it if the wallet belongs to a CodeStreak profile.
      select w.profile_id into prof from public.wallets w where w.address = p ->> 'wallet' and w.verified_at is not null;
      if prof is null then
        continue;
      end if;
      insert into public.memberships (challenge_id, profile_id, wallet_address, participant_address, deposited, status, joined_at, finalized_at, claimed_at)
      values (ch.id, prof, p ->> 'wallet', p ->> 'address', (p ->> 'deposited')::numeric, (p ->> 'status')::public.membership_status,
              to_timestamp((p ->> 'joined_at')::double precision),
              case when (p ->> 'finalized')::boolean then now() end, case when (p ->> 'claimed')::boolean then now() end)
      on conflict do nothing
      returning * into m;
      if m.id is null then
        warnings := warnings || jsonb_build_array('wallet ' || (p ->> 'wallet') || ' joined, but its profile is already in this challenge with another wallet');
        continue;
      end if;
      changes := changes || jsonb_build_array('member added: ' || (p ->> 'wallet'));
      insert into public.audit_log (actor_kind, action, entity_type, entity_id, details)
      values ('worker', 'reconcile.member_added', 'membership', m.id::text, jsonb_build_object('wallet', p ->> 'wallet', 'challenge', ch.id));
    else
      member_diff := '{}';
      if m.participant_address is distinct from p ->> 'address' then
        member_diff := member_diff || jsonb_build_object('participant_address', jsonb_build_object('db', m.participant_address, 'chain', p ->> 'address'));
      end if;
      if m.deposited <> (p ->> 'deposited')::numeric then
        member_diff := member_diff || jsonb_build_object('deposited', jsonb_build_object('db', m.deposited::text, 'chain', p ->> 'deposited'));
      end if;
      if m.status::text <> p ->> 'status' then
        member_diff := member_diff || jsonb_build_object('status', jsonb_build_object('db', m.status, 'chain', p ->> 'status'));
      end if;
      if (m.finalized_at is not null) <> (p ->> 'finalized')::boolean then
        member_diff := member_diff || jsonb_build_object('finalized', jsonb_build_object('db', m.finalized_at is not null, 'chain', (p ->> 'finalized')::boolean));
      end if;
      if (m.claimed_at is not null) <> (p ->> 'claimed')::boolean then
        member_diff := member_diff || jsonb_build_object('claimed', jsonb_build_object('db', m.claimed_at is not null, 'chain', (p ->> 'claimed')::boolean));
      end if;
      if member_diff <> '{}' then
        update public.memberships set
          participant_address = p ->> 'address',
          deposited = (p ->> 'deposited')::numeric,
          status = (p ->> 'status')::public.membership_status,
          finalized_at = case when (p ->> 'finalized')::boolean then coalesce(finalized_at, now()) end,
          claimed_at = case when (p ->> 'claimed')::boolean then coalesce(claimed_at, now()) end,
          payout = case when (p ->> 'claimed')::boolean then payout end
        where id = m.id;
        changes := changes || jsonb_build_array('member ' || (p ->> 'wallet') || ': ' || (select string_agg(k, ', ') from jsonb_object_keys(member_diff) k));
        insert into public.audit_log (actor_kind, action, entity_type, entity_id, details)
        values ('worker', 'reconcile.member_fixed', 'membership', m.id::text, member_diff);
      end if;
    end if;

    -- Days: the on-chain flag follows the chain. A different result on-chain is reported, never overwritten
    -- (the stored receipt is the evidence for the database's result).
    chain_days := coalesce(p -> 'days', '{}');
    for d in
      select r.day, r.result::text as result, r.onchain_at, chain_days ->> r.day::text as chain_result
        from public.day_results r where r.membership_id = m.id
    loop
      if d.chain_result is not null and d.onchain_at is null then
        update public.day_results set onchain_at = now() where membership_id = m.id and day = d.day;
        changes := changes || jsonb_build_array(format('day %s of %s: on-chain', d.day + 1, p ->> 'wallet'));
        insert into public.audit_log (actor_kind, action, entity_type, entity_id, details)
        values ('worker', 'reconcile.day_onchain', 'membership', m.id::text, jsonb_build_object('day', d.day));
      elsif d.chain_result is null and d.onchain_at is not null then
        update public.day_results set onchain_at = null, record_tx = null where membership_id = m.id and day = d.day;
        changes := changes || jsonb_build_array(format('day %s of %s: not on-chain, will be recorded again', d.day + 1, p ->> 'wallet'));
        insert into public.audit_log (actor_kind, action, entity_type, entity_id, details)
        values ('worker', 'reconcile.day_not_onchain', 'membership', m.id::text, jsonb_build_object('day', d.day));
      end if;
      if d.chain_result is not null and d.chain_result <> d.result then
        warnings := warnings || jsonb_build_array(format('day %s of %s: database says %s, chain says %s', d.day + 1, p ->> 'wallet', d.result, d.chain_result));
      end if;
    end loop;
  end loop;

  -- Memberships with no on-chain participant (reported only: never deleted).
  select count(*) into n from public.memberships x
   where x.challenge_id = ch.id
     and not exists (select 1 from jsonb_array_elements(coalesce(p_participants, '[]')) e
                      where e ->> 'wallet' = x.wallet_address or e ->> 'address' = x.participant_address);
  if n > 0 then
    warnings := warnings || jsonb_build_array(n || ' membership(s) have no on-chain participant');
  end if;

  return jsonb_build_object('challenge_id', ch.id, 'added', added, 'changes', changes, 'warnings', warnings);
end $$;

revoke all on function public.reconcile_challenge(jsonb, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.reconcile_challenge(jsonb, jsonb, boolean) to service_role;

-- Twice an hour (between the other wakes): a full chain -> database reconciliation.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('codestreak-reconcile', '5,35 * * * *', $job$select private.wake_worker('reconcile')$job$);
  else
    raise notice 'pg_cron not available: reconcile schedule not created (expected outside Supabase)';
  end if;
end $$;
