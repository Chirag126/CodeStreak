-- Phase 43 fix: one transaction now carries several players (batched day results, payouts and
-- badge mints), so a transaction signature is no longer unique per row.
--
-- - day_results.record_tx and badges.mint_tx: no longer unique (indexed for lookups). The rows
--   themselves stay unique per (membership, day) and per mint address.
-- - receipts: unique per (transaction, wallet, kind) instead of per transaction. A wallet still
--   can't be paid twice by one transaction, and every player in a batched payout gets a receipt
--   (before, all but the first were skipped by "on conflict do nothing").
-- - record_payout: idempotent on (transaction, wallet, kind).

alter table public.day_results drop constraint day_results_record_tx_key;
create index day_results_record_tx on public.day_results (record_tx) where record_tx is not null;

alter table public.badges drop constraint badges_mint_tx_key;
create index badges_mint_tx on public.badges (mint_tx) where mint_tx is not null;

alter table public.receipts drop constraint receipts_tx_signature_key;
alter table public.receipts add constraint receipts_tx_wallet_kind_key unique (tx_signature, wallet, kind);

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
    on conflict (tx_signature, wallet, kind) do nothing;
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
