-- Phase 20 tests: private groups - hashed, expiring invite links; accept/decline; member-only visibility.
\set QUIET on
set client_min_messages = notice;

create function pg_temp.expect_fail(label text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'rejected  %  [%: %]', label, sqlstate, left(sqlerrm, 80);
    return;
  end;
  raise exception 'NOT REJECTED: %', label;
end $$;

-- 41 creator, 42 friend invited by ID, 43 outsider, 44 redeemed a link
insert into auth.users (id) values ('00000000-0000-0000-0000-000000000041'), ('00000000-0000-0000-0000-000000000042'),
  ('00000000-0000-0000-0000-000000000043'), ('00000000-0000-0000-0000-000000000044');

insert into public.challenges (id, creator_id, title, visibility, token, mint, buy_in, start_at, day_length_secs, num_days,
  join_deadline_at, min_participants, max_participants, shield_price, max_shields, shield_grace_secs, verify_window_secs,
  dispute_window_secs, rules, rules_hash)
values ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000041', 'Friends only', 'private', 'usdc',
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', 10000000, '2026-12-10T00:00:00Z', 86400, 7, '2026-12-10T00:00:00Z',
  2, 10, 0, 0, 0, 3600, 3600, '{}', repeat('33', 32));

-- Links: only a 64-hex SHA-256 is stored, and every link expires (<= 30 days) with a use limit.
insert into public.invitations (id, challenge_id, invited_by, code_hash, max_uses, expires_at) values
  ('a7100000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000041', repeat('e1', 32), 1, now() + interval '3 days');

select pg_temp.expect_fail('raw token stored instead of a hash', $q$
  insert into public.invitations (challenge_id, invited_by, code_hash, max_uses, expires_at)
  values ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000041', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde', 1, now() + interval '1 day') $q$);
select pg_temp.expect_fail('link without expiry', $q$
  insert into public.invitations (challenge_id, invited_by, code_hash, max_uses)
  values ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000041', repeat('e2', 32), 1) $q$);
select pg_temp.expect_fail('link without use limit', $q$
  insert into public.invitations (challenge_id, invited_by, code_hash, expires_at)
  values ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000041', repeat('e3', 32), now() + interval '1 day') $q$);
select pg_temp.expect_fail('link living over 30 days', $q$
  insert into public.invitations (challenge_id, invited_by, code_hash, max_uses, expires_at)
  values ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000041', repeat('e4', 32), 1, now() + interval '31 days') $q$);
select pg_temp.expect_fail('same link hash twice', $q$
  insert into public.invitations (challenge_id, invited_by, code_hash, max_uses, expires_at)
  values ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000041', repeat('e1', 32), 1, now() + interval '1 day') $q$);
select pg_temp.expect_fail('reused link: uses beyond the limit', $q$
  update public.invitations set use_count = 2 where id = 'a7100000-0000-0000-0000-000000000001' $q$);

-- Invite by public ID (pending), then the link redemption that creates an accepted invitation.
insert into public.invitations (id, challenge_id, invited_by, invitee_id) values
  ('a7100000-0000-0000-0000-000000000002', 'a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000042');
update public.invitations set use_count = 1 where id = 'a7100000-0000-0000-0000-000000000001';
insert into public.invitations (challenge_id, invited_by, invitee_id, status, responded_at, via_link) values
  ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000044', 'accepted', now(), 'a7100000-0000-0000-0000-000000000001');

select pg_temp.expect_fail('second live invitation for the same friend', $q$
  insert into public.invitations (challenge_id, invited_by, invitee_id)
  values ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000044') $q$);
select pg_temp.expect_fail('via_link on a link row', $q$
  insert into public.invitations (challenge_id, invited_by, code_hash, max_uses, expires_at, via_link)
  values ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000041', repeat('e5', 32), 1, now() + interval '1 day', 'a7100000-0000-0000-0000-000000000001') $q$);

-- Member-only visibility (RLS).
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000043', false);
do $$
begin
  assert (select count(*) from public.challenges where id = 'a7000000-0000-0000-0000-000000000001') = 0, 'an outsider cannot see the private group';
  assert (select count(*) from public.challenge_overview where id = 'a7000000-0000-0000-0000-000000000001') = 0, 'nor through the overview';
  assert (select count(*) from public.invitations where challenge_id = 'a7000000-0000-0000-0000-000000000001') = 0, 'nor its invitations or link hashes';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000042', false);
do $$
begin
  assert (select count(*) from public.challenges where id = 'a7000000-0000-0000-0000-000000000001') = 1, 'the friend invited by ID can see it';
  assert (select count(*) from public.invitations) = 1, 'and sees only their own invitation';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000044', false);
do $$
begin
  assert (select count(*) from public.challenges where id = 'a7000000-0000-0000-0000-000000000001') = 1, 'whoever redeemed the link can see it';
end $$;
reset role;

-- Declining removes visibility; a fresh invitation after a decline is allowed.
update public.invitations set status = 'declined', responded_at = now() where id = 'a7100000-0000-0000-0000-000000000002';
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000042', false);
do $$
begin
  assert (select count(*) from public.challenges where id = 'a7000000-0000-0000-0000-000000000001') = 0, 'a declined invitation hides the group again';
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into public.invitations (challenge_id, invited_by, invitee_id) values
  ('a7000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000042');

\echo 'private groups: all tests passed'
