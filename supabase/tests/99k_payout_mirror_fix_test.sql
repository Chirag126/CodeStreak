-- Video 1 review: a member marked claimed without an amount gets it filled in, once.
\set QUIET on
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000e7');
insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash, onchain_address, onchain_challenge_id, participant_count, pool_state) values
  ('fe000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e7', 'Payout fix', 'public', 'usdc', 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr', 1000000,
   now() - interval '2 hours', 600, 3, now() - interval '3 hours', 2, 10, 0, 0, 0, 600, 900, '{"providers":["github"]}', repeat('ef', 32),
   'Pz111111111111111111111111111111111111111111', 903, 1, 'cancelled');
insert into public.memberships (id, challenge_id, profile_id, wallet_address, participant_address, deposited, status, claimed_at) values
  ('fe100000-0000-0000-0000-000000000001', 'fe000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000e7',
   'Rf5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'Rp111111111111111111111111111111111111111111', 1000000, 'active', now() - interval '1 hour');
do $$
declare before timestamptz;
begin
  select claimed_at into before from public.memberships where id = 'fe100000-0000-0000-0000-000000000001';
  perform public.record_payout('fe000000-0000-0000-0000-000000000001', 'Rf5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'refund', 1000000, null);
  assert (select payout from public.memberships where id = 'fe100000-0000-0000-0000-000000000001') = 1000000, 'amount filled in';
  assert (select claimed_at from public.memberships where id = 'fe100000-0000-0000-0000-000000000001') = before, 'claimed_at kept';
  -- A recorded amount is never overwritten.
  perform public.record_payout('fe000000-0000-0000-0000-000000000001', 'Rf5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 'refund', 5, null);
  assert (select payout from public.memberships where id = 'fe100000-0000-0000-0000-000000000001') = 1000000, 'not overwritten';
  assert (select count(*) from public.audit_log where action = 'payout.refund' and entity_id = 'fe000000-0000-0000-0000-000000000001') = 1, 'logged once';
end $$;
do $$ begin raise notice '99k_payout_mirror_fix_test: all passed'; end $$;
