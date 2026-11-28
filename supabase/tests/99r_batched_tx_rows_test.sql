-- Phase 43 fix: one transaction carries several players (batched day results, payouts, badge mints).
\set QUIET on
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at, last_sign_in_at) values
  ('ff000000-0000-0000-0000-0000000004a1', 'b-ann@example.com', now(), now()),
  ('ff000000-0000-0000-0000-0000000004a2', 'b-ben@example.com', now(), now());
insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash, onchain_address, onchain_challenge_id, participant_count) values
  ('a4300000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-0000000004a1', 'Batch group', 'public', 'sol', 'So11111111111111111111111111111111111111112', 10000000,
   now() - interval '1 hour', 86400, 3, now() - interval '2 hours', 2, 10, 2000000, 1, 300, 600, 900, '{"providers":["github"]}', repeat('cd', 32),
   'Bq431111111111111111111111111111111111111111', 43101, 2);
insert into public.memberships (id, challenge_id, profile_id, wallet_address, deposited) values
  ('a4310000-0000-0000-0000-000000000001', 'a4300000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-0000000004a1', 'Ba5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000),
  ('a4310000-0000-0000-0000-000000000002', 'a4300000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-0000000004a2', 'Bb5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000);

do $$
declare tx text := repeat('5', 87);
begin
  -- Two players' day results in one transaction.
  insert into public.day_results (membership_id, day, result, evidence_hash, record_tx) values
    ('a4310000-0000-0000-0000-000000000001', 0, 'verified', repeat('ab', 32), tx),
    ('a4310000-0000-0000-0000-000000000002', 0, 'failed', repeat('ab', 32), tx);

  -- Two payouts in one transaction: both mirrored, each with its own receipt; repeating changes nothing.
  perform public.record_payout('a4300000-0000-0000-0000-000000000001', 'Ba5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'reward', 15000000, tx);
  perform public.record_payout('a4300000-0000-0000-0000-000000000001', 'Bb5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'refund', 10000000, tx);
  perform public.record_payout('a4300000-0000-0000-0000-000000000001', 'Bb5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'refund', 10000000, tx);
  assert (select count(*) from public.receipts where tx_signature = tx) = 2, 'one receipt per player';
  assert (select count(*) from public.memberships where challenge_id = 'a4300000-0000-0000-0000-000000000001' and payout is not null) = 2, 'both mirrored';

  -- The same wallet can't get the same kind twice from one transaction.
  begin
    insert into public.receipts (challenge_id, wallet, kind, amount, tx_signature)
    values ('a4300000-0000-0000-0000-000000000001', 'Ba5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'reward', 1, tx);
    raise exception 'NOT REJECTED: duplicate receipt';
  exception when unique_violation then null;
  end;

  -- Two badges minted in one transaction (each its own mint).
  insert into public.badges (profile_id, badge_code, challenge_id, mint_address, mint_tx) values
    ('ff000000-0000-0000-0000-0000000004a1', 'survivor', 'a4300000-0000-0000-0000-000000000001', 'Bm1vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', tx),
    ('ff000000-0000-0000-0000-0000000004a2', 'survivor', 'a4300000-0000-0000-0000-000000000001', 'Bm2vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', tx);
  begin
    insert into public.badges (profile_id, badge_code, challenge_id, mint_address, mint_tx) values
      ('ff000000-0000-0000-0000-0000000004a1', 'survivor', null, 'Bm1vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', tx);
    raise exception 'NOT REJECTED: same mint twice';
  exception when unique_violation then null;
  end;
end $$;

delete from public.challenges where id = 'a4300000-0000-0000-0000-000000000001';
do $$ begin raise notice '99r_batched_tx_rows_test: all passed'; end $$;
