-- Phase 32 - Shields: reconciliation adds Shields that are on-chain but missing in the database
-- (e.g. a Shield bought while the app's mirror failed). Their transaction isn't known then, so the
-- signature becomes optional (still unique when present).
alter table public.shields alter column tx_signature drop not null;

/**
 * p_shields: [{ "wallet": base58, "days": [0, 2] }] as the chain has them. Adds the missing rows
 * (price = the challenge's Shield price), logs each in audit_log, returns how many were added.
 */
create or replace function public.reconcile_shields(p_challenge_address text, p_shields jsonb)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  ch public.challenges;
  added integer := 0;
  r record;
begin
  select * into ch from public.challenges where onchain_address = p_challenge_address;
  if not found or ch.shield_price <= 0 then return 0; end if;
  for r in
    select m.id as membership_id, (d.value)::smallint as day
      from jsonb_array_elements(coalesce(p_shields, '[]')) e
      join public.memberships m on m.challenge_id = ch.id and m.wallet_address = e.value ->> 'wallet'
      cross join lateral jsonb_array_elements_text(e.value -> 'days') d
     where not exists (select 1 from public.shields s where s.membership_id = m.id and s.day = (d.value)::smallint)
  loop
    insert into public.shields (membership_id, day, price_paid, tx_signature) values (r.membership_id, r.day, ch.shield_price, null)
    on conflict do nothing;
    if found then
      added := added + 1;
      insert into public.audit_log (actor_kind, action, entity_type, entity_id, details)
      values ('worker', 'reconcile.shield_added', 'membership', r.membership_id::text, jsonb_build_object('day', r.day));
    end if;
  end loop;
  return added;
end $$;
revoke all on function public.reconcile_shields(text, jsonb) from public, anon, authenticated;
grant execute on function public.reconcile_shields(text, jsonb) to service_role;
