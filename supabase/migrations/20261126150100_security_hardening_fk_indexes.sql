-- Phase 41.1: covering indexes for foreign keys
-- Deleting a profile / run / challenge checks these references; without an index each check scans
-- the whole table (Supabase lint 0001).
create index if not exists admin_notes_profile on public.admin_notes (profile_id);
create index if not exists disputes_opened_by on public.disputes (opened_by);
create index if not exists disputes_reviewer on public.disputes (reviewer_id);
create index if not exists member_day_checks_checked_by on public.member_day_checks (checked_by);
create index if not exists member_day_checks_run on public.member_day_checks (run_id);
create index if not exists notifications_challenge on public.notifications (challenge_id);
create index if not exists user_reports_reported on public.user_reports (reported_id);
