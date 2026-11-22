-- Sign-in attempt log for the "3 tries, then wait" rule. Stores only a SHA-256 of the email.
-- Written and read only by the server (service role); RLS on with no policies blocks everyone else.
create type public.sign_in_attempt_kind as enum ('send', 'bad_code');

create table public.sign_in_attempts (
  id bigint generated always as identity primary key,
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  kind public.sign_in_attempt_kind not null,
  at timestamptz not null default now()
);
create index sign_in_attempts_lookup on public.sign_in_attempts (email_hash, kind, at desc);
alter table public.sign_in_attempts enable row level security;
revoke all on public.sign_in_attempts from anon, authenticated;
