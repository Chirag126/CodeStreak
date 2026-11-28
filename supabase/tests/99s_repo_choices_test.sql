-- Individual repository mode: who may choose, when a choice applies, and the lock.
\set QUIET on
set client_min_messages = warning;

insert into auth.users (id, email, email_confirmed_at, last_sign_in_at) values
  ('ff000000-0000-0000-0000-0000000005a1', 'rc-owner@example.com', now(), now()),
  ('ff000000-0000-0000-0000-0000000005a2', 'rc-ann@example.com', now(), now()),
  ('ff000000-0000-0000-0000-0000000005a3', 'rc-ben@example.com', now(), now());

-- c1: individual, joining open, starts in 1 h (days of 10 min).  c2: individual, started 25 min ago.
-- c3: shared mode.  c4: private individual group, joining open.
insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash, onchain_address, onchain_challenge_id, participant_count) values
  ('a4500000-0000-0000-0000-000000000001', 'ff000000-0000-0000-0000-0000000005a1', 'RC open', 'public', 'sol', 'So11111111111111111111111111111111111111112', 10000000,
   now() + interval '1 hour', 600, 3, now() + interval '59 minutes', 2, 10, 0, 0, 0, 180, 180,
   '{"providers":["github"],"github":{"minMeaningfulLines":15,"repoMode":"individual"}}', repeat('cd', 32), 'Rc451111111111111111111111111111111111111111', 45101, 0),
  ('a4500000-0000-0000-0000-000000000002', 'ff000000-0000-0000-0000-0000000005a1', 'RC running', 'public', 'sol', 'So11111111111111111111111111111111111111112', 10000000,
   now() - interval '25 minutes', 600, 6, now() - interval '26 minutes', 2, 10, 0, 0, 0, 180, 180,
   '{"providers":["github"],"github":{"minMeaningfulLines":15,"repoMode":"individual"}}', repeat('cd', 32), 'Rc452111111111111111111111111111111111111111', 45102, 1),
  ('a4500000-0000-0000-0000-000000000003', 'ff000000-0000-0000-0000-0000000005a1', 'RC shared', 'public', 'sol', 'So11111111111111111111111111111111111111112', 10000000,
   now() + interval '1 hour', 600, 3, now() + interval '59 minutes', 2, 10, 0, 0, 0, 180, 180,
   '{"providers":["github"],"github":{"minMeaningfulLines":15,"repoMode":"shared","repos":[{"id":7,"fullName":"acme/team"}]}}', repeat('cd', 32), 'Rc453111111111111111111111111111111111111111', 45103, 0),
  ('a4500000-0000-0000-0000-000000000004', 'ff000000-0000-0000-0000-0000000005a1', 'RC private', 'private', 'sol', 'So11111111111111111111111111111111111111112', 10000000,
   now() + interval '1 hour', 600, 3, now() + interval '59 minutes', 2, 10, 0, 0, 0, 180, 180,
   '{"providers":["github"],"github":{"minMeaningfulLines":15,"repoMode":"individual"}}', repeat('cd', 32), 'Rc454111111111111111111111111111111111111111', 45104, 0);
insert into public.memberships (id, challenge_id, profile_id, wallet_address, deposited) values
  ('a4510000-0000-0000-0000-000000000001', 'a4500000-0000-0000-0000-000000000002', 'ff000000-0000-0000-0000-0000000005a2', 'Ra5vCCzJBaUEiv4omcdY5Hu2fwk8VpaSC3fCPuu7JTaa', 10000000);

do $$
declare r jsonb; c2_start timestamptz := (select start_at from public.challenges where id = 'a4500000-0000-0000-0000-000000000002');
begin
  -- Before day 1 (not a member yet, joining open): applies from the start; a second pick replaces it.
  r := public.set_repo_choice('ff000000-0000-0000-0000-0000000005a2', 'a4500000-0000-0000-0000-000000000001', 501, 9001, 'ann/streak');
  assert (r ->> 'changed')::boolean and (r ->> 'effective_from')::timestamptz = (select start_at from public.challenges where id = 'a4500000-0000-0000-0000-000000000001'), 'pre-start: from day 1';
  r := public.set_repo_choice('ff000000-0000-0000-0000-0000000005a2', 'a4500000-0000-0000-0000-000000000001', 502, 9001, 'ann/other');
  assert (select count(*) from public.challenge_repo_choices where challenge_id = 'a4500000-0000-0000-0000-000000000001') = 1, 'pre-start picks replace each other';
  assert (select repo_id from public.challenge_repo_choices where challenge_id = 'a4500000-0000-0000-0000-000000000001') = 502;
  r := public.set_repo_choice('ff000000-0000-0000-0000-0000000005a2', 'a4500000-0000-0000-0000-000000000001', 502, 9001, 'ann/other');
  assert not (r ->> 'changed')::boolean, 'same repository: no change';

  -- During the challenge (day 3 under way, 25 min in): applies from the next day (30 min), never today.
  r := public.set_repo_choice('ff000000-0000-0000-0000-0000000005a2', 'a4500000-0000-0000-0000-000000000002', 501, 9001, 'ann/streak');
  assert (r ->> 'effective_from')::timestamptz = c2_start + interval '30 minutes', format('next day, got %s', r ->> 'effective_from');

  -- Locked once a day is verified.
  insert into public.day_results (membership_id, day, result, evidence_hash) values ('a4510000-0000-0000-0000-000000000001', 0, 'verified', repeat('ab', 32));
  begin
    perform public.set_repo_choice('ff000000-0000-0000-0000-0000000005a2', 'a4500000-0000-0000-0000-000000000002', 503, 9001, 'ann/third');
    raise exception 'NOT REJECTED: change after a verified day';
  exception when invalid_parameter_value then null;
  end;

  -- Not a member and joining closed: refused.
  begin
    perform public.set_repo_choice('ff000000-0000-0000-0000-0000000005a3', 'a4500000-0000-0000-0000-000000000002', 601, 9002, 'ben/x');
    raise exception 'NOT REJECTED: outsider after the join deadline';
  exception when invalid_parameter_value then null;
  end;
  -- Shared-mode challenge: no per-player repositories.
  begin
    perform public.set_repo_choice('ff000000-0000-0000-0000-0000000005a3', 'a4500000-0000-0000-0000-000000000003', 601, 9002, 'ben/x');
    raise exception 'NOT REJECTED: shared mode';
  exception when invalid_parameter_value then null;
  end;
  -- Private group without an invitation: refused; with one: allowed.
  begin
    perform public.set_repo_choice('ff000000-0000-0000-0000-0000000005a3', 'a4500000-0000-0000-0000-000000000004', 601, 9002, 'ben/x');
    raise exception 'NOT REJECTED: private group, not invited';
  exception when insufficient_privilege then null;
  end;
  insert into public.invitations (challenge_id, invited_by, invitee_id) values ('a4500000-0000-0000-0000-000000000004', 'ff000000-0000-0000-0000-0000000005a1', 'ff000000-0000-0000-0000-0000000005a3');
  perform public.set_repo_choice('ff000000-0000-0000-0000-0000000005a3', 'a4500000-0000-0000-0000-000000000004', 601, 9002, 'ben/x');

  -- Bad names never get in.
  begin
    perform public.set_repo_choice('ff000000-0000-0000-0000-0000000005a2', 'a4500000-0000-0000-0000-000000000001', 504, 9001, 'not a repo');
    raise exception 'NOT REJECTED: bad name';
  exception when check_violation then null;
  end;
end $$;

-- Only the service role may record choices; players read only their own.
do $$ begin
  assert not has_function_privilege('authenticated', 'public.set_repo_choice(uuid, uuid, bigint, bigint, text)', 'execute');
  assert not has_function_privilege('anon', 'public.set_repo_choice(uuid, uuid, bigint, bigint, text)', 'execute');
  assert not has_table_privilege('authenticated', 'public.challenge_repo_choices', 'insert');
  assert not has_table_privilege('anon', 'public.challenge_repo_choices', 'select');
end $$;
set role authenticated;
set request.jwt.claim.sub = 'ff000000-0000-0000-0000-0000000005a3';
do $$ begin
  assert (select count(*) from public.challenge_repo_choices) = 1, 'sees only own choices';
  begin
    update public.challenge_repo_choices set repo_id = 1;
    raise exception 'NOT REJECTED: direct update';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
reset request.jwt.claim.sub;

delete from public.challenges where id::text like 'a4500000-%';
do $$ begin raise notice '99s_repo_choices_test: all passed'; end $$;
