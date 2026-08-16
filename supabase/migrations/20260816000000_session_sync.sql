begin;

-- A programme/day/date is already the device-side session identity. Keep one live
-- canonical cloud row for it, while allowing any number of explicitly linked conflict
-- copies. NULL programme ids are historical/unlinked records and remain outside this rule.
create unique index session_logs_canonical_identity_unique
  on public.session_logs (owner_id, program_id, session_date, day)
  where deleted_at is null
    and conflict_of is null
    and program_id is not null;

commit;
