-- Video 1 review fix: a payout made outside the verification job (e.g. a member that joined outside
-- the app and was added by reconcile with only `claimed_at`) was never given its amount, so the
-- member showed no refund and the challenge was marked "payouts done".
--
-- 1. record_payout fills a missing amount even when `claimed_at` is already set (still never
--    overwrites a recorded amount, still idempotent on the transaction signature).
-- 2. Challenges with such a member go back to the payout step, which mirrors the amount from the
--    chain (no transaction is sent: the chain already shows the member as paid).

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
    update public.memberships set claimed_at = coalesce(claimed_at, now()), payout = p_amount
     where challenge_id = p_challenge and wallet_address = p_wallet and (claimed_at is null or payout is null)
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
revoke all on function public.record_payout(uuid, text, public.receipt_kind, numeric, text) from public, anon, authenticated;
grant execute on function public.record_payout(uuid, text, public.receipt_kind, numeric, text) to service_role;

update public.challenges c set payouts_done_at = null
 where c.pool_state in ('settled', 'cancelled') and c.payouts_done_at is not null
   and exists (select 1 from public.memberships m where m.challenge_id = c.id and m.claimed_at is not null and m.payout is null);
