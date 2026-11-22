-- Phase 16 - mirror on-chain state into the app tables after each confirmed transaction.
-- Challenges created outside the app (devnet scripts, the demo seed) have no CodeStreak profile as
-- creator, so creator_id may be null. Everything synced is read from the chain, never from users.

alter table public.challenges alter column creator_id drop not null;
comment on column public.challenges.creator_id is 'Profile that created it in the app; null when created outside the app (scripts, demo seed).';

-- One receipt per (transaction, kind) is already guaranteed by receipts.tx_signature being unique.
-- Sync upserts memberships by (challenge, profile); the Participant PDA must also be unique (already).
