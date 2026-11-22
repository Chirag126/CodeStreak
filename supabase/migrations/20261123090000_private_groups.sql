-- Phase 20 - private groups: invite links are stored as SHA-256 hashes only, always expire and
-- have a use limit; invitations can be declined; one live invitation per person per group.

alter type public.invitation_status add value if not exists 'declined';

-- Links: the raw token is shown once to the creator and never stored.
alter table public.invitations drop column code;   -- also drops the checks that referenced it
alter table public.invitations
  add column code_hash text unique check (code_hash ~ '^[0-9a-f]{64}$'),
  -- a person's invitation that came from redeeming a link (audit trail)
  add column via_link uuid references public.invitations (id) on delete set null,
  add constraint invitations_person_or_link check ((invitee_id is null) <> (code_hash is null)),
  add constraint invitations_links_expire check (code_hash is null or (expires_at is not null and max_uses is not null)),
  add constraint invitations_link_lifetime check (expires_at is null or expires_at <= created_at + interval '30 days'),
  add constraint invitations_via_link_is_person check (via_link is null or invitee_id is not null);
create index invitations_via_link on public.invitations (via_link);

-- One live (pending or accepted) invitation per person per group.
drop index public.invitations_one_pending_per_invitee;
create unique index invitations_one_live_per_invitee
  on public.invitations (challenge_id, invitee_id) where status in ('pending', 'accepted') and invitee_id is not null;
