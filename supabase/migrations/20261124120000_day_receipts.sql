-- Phase 27 - Rules engine and receipts.
-- A receipt is the canonical JSON of the facts behind a day's verdict (rules-engine.ts); its SHA-256
-- is the evidence hash in day_results and on-chain. The database re-checks everything it can:
-- the bytes hash to the stored hash, and the receipt names the same challenge, wallet, day and verdict
-- as the result it belongs to. Receipts list commit SHAs and submission ids, so they follow the
-- member's "share check details" setting; day_results (public) carries only the hash.

-- Confidence of the latest preview check, per provider (0-100).
alter table public.member_day_checks add column confidence smallint check (confidence between 0 and 100);

create table public.day_receipts (
  membership_id uuid not null,
  day smallint not null check (day between 0 and 59),
  engine text not null check (engine ~ '^codestreak-rules/[0-9]+$'),
  receipt text not null check (octet_length(receipt) <= 200000),
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (membership_id, day),
  foreign key (membership_id, day) references public.day_results (membership_id, day) on delete cascade deferrable initially deferred,
  constraint receipt_hash_matches check (evidence_hash = encode(sha256(convert_to(receipt, 'UTF8')), 'hex')),
  constraint receipt_names_day check ((receipt::jsonb ->> 'day')::integer = day and receipt::jsonb ->> 'engine' = engine)
);
alter table public.day_receipts enable row level security;
create policy "receipts of members whose checks are visible" on public.day_receipts for select to anon, authenticated
  using (private.can_view_member_checks(membership_id));
revoke all on public.day_receipts from anon, authenticated;
grant select on public.day_receipts to anon, authenticated;

/** At commit: a receipt and its day result must agree (hash, verdict, challenge, wallet). */
create or replace function private.check_day_receipt() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  mid uuid := coalesce(new.membership_id, old.membership_id);
  d smallint := coalesce(new.day, old.day);
  rec public.day_receipts;
  res public.day_results;
  doc jsonb;
  wallet text;
  address text;
begin
  select * into rec from public.day_receipts where membership_id = mid and day = d;
  if not found then return null; end if;
  select * into res from public.day_results where membership_id = mid and day = d;
  if not found then
    raise exception 'receipt for day % has no day result', d using errcode = '23503';
  end if;
  doc := rec.receipt::jsonb;
  if res.evidence_hash <> rec.evidence_hash then
    raise exception 'day % result hash % does not match its receipt %', d, res.evidence_hash, rec.evidence_hash using errcode = '23514';
  end if;
  if res.result::text <> doc ->> 'verdict' then
    raise exception 'day % result "%" does not match the receipt verdict "%"', d, res.result, doc ->> 'verdict' using errcode = '23514';
  end if;
  select m.wallet_address, c.onchain_address into wallet, address
  from public.memberships m join public.challenges c on c.id = m.challenge_id where m.id = mid;
  if doc ->> 'member' is distinct from wallet or doc ->> 'challenge' is distinct from address then
    raise exception 'receipt for day % names another member or challenge', d using errcode = '23514';
  end if;
  return null;
end $$;
revoke all on function private.check_day_receipt() from public;

create constraint trigger day_receipts_consistent after insert or update on public.day_receipts
  deferrable initially deferred for each row execute function private.check_day_receipt();
create constraint trigger day_results_match_receipt after update on public.day_results
  deferrable initially deferred for each row execute function private.check_day_receipt();
