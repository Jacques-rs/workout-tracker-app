begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

select ok(to_regclass('public.programs') is not null, 'programs table exists');
select ok(to_regclass('public.session_logs') is not null, 'session_logs table exists');
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.programs'::regclass),
  'programs has forced RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.session_logs'::regclass),
  'session_logs has forced RLS'
);

select ok(not has_table_privilege('anon', 'public.programs', 'select'),
  'anonymous users cannot read programs');
select ok(not has_table_privilege('anon', 'public.session_logs', 'select'),
  'anonymous users cannot read session logs');
select ok(not has_table_privilege('anon', 'public.programs', 'insert'),
  'anonymous users cannot create programs');
select ok(has_table_privilege('authenticated', 'public.programs', 'select'),
  'authenticated users can reach programs through RLS');
select ok(not has_table_privilege('authenticated', 'public.programs', 'delete'),
  'authenticated users cannot hard-delete programs');
select ok(not has_table_privilege('authenticated', 'public.session_logs', 'delete'),
  'authenticated users cannot hard-delete session logs');
select ok(has_table_privilege('service_role', 'public.programs', 'delete'),
  'service role retains administrative program access');

create table public.default_privilege_probe (id integer);
select ok(not has_table_privilege('anon', 'public.default_privilege_probe', 'select'),
  'new tables are not automatically exposed to anon');
select ok(not has_table_privilege('authenticated', 'public.default_privilege_probe', 'select'),
  'new tables are not automatically exposed to authenticated');
select ok(not has_table_privilege('service_role', 'public.default_privilege_probe', 'select'),
  'new tables require an explicit service-role grant');
drop table public.default_privilege_probe;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000101', 'rls-one@example.invalid'),
  ('00000000-0000-0000-0000-000000000102', 'rls-two@example.invalid');

insert into public.programs (
  id, owner_id, title, schema_version, program_version, payload
) values
  (
    '10000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000101',
    'User one program', 'tp-program-2', 1,
    '{"meta":{"schema":"tp-program-2"},"exercises":[]}'::jsonb
  ),
  (
    '10000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000102',
    'User two program', 'tp-program-2', 1,
    '{"meta":{"schema":"tp-program-2"},"exercises":[]}'::jsonb
  );

insert into public.session_logs (
  id, owner_id, program_id, session_date, day, week,
  schema_version, program_version, payload
) values
  (
    '20000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000101',
    '10000000-0000-0000-0000-000000000101',
    '2026-01-01', 'Day 1', 1, 'tp-session-3', 1,
    '{"schema":"tp-session-3"}'::jsonb
  ),
  (
    '20000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000102',
    '10000000-0000-0000-0000-000000000102',
    '2026-01-01', 'Day 1', 1, 'tp-session-3', 1,
    '{"schema":"tp-session-3"}'::jsonb
  );

select is(
  (select revision from public.programs
   where id = '10000000-0000-0000-0000-000000000101'),
  1::bigint,
  'new records start at revision one'
);

select throws_ok(
  $$insert into public.programs (
      owner_id, title, schema_version, payload
    ) values (
      '00000000-0000-0000-0000-000000000101',
      'Bad schema marker', 'tp-program-2',
      '{"meta":{"schema":"tp-program-1"}}'::jsonb
    )$$,
  '23514',
  'new row for relation "programs" violates check constraint "programs_payload_schema_matches"',
  'program payload schema must match its metadata'
);

select throws_ok(
  $$insert into public.session_logs (
      owner_id, session_date, day, week, schema_version, payload
    ) values (
      '00000000-0000-0000-0000-000000000101',
      '2026-01-01', 'Day 1', 1, 'tp-session-4',
      '{"schema":"tp-session-4"}'::jsonb
    )$$,
  '23514',
  'new row for relation "session_logs" violates check constraint "session_logs_schema_version_supported"',
  'unsupported session schemas are rejected'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000101';

select is((select count(*) from public.programs), 1::bigint,
  'user one sees only their program');
select is((select count(*) from public.session_logs), 1::bigint,
  'user one sees only their session');

select throws_ok(
  $$insert into public.session_logs (
      owner_id, program_id, session_date, day, week, schema_version, payload
    ) values (
      '00000000-0000-0000-0000-000000000101',
      '10000000-0000-0000-0000-000000000101',
      '2026-01-01', 'Day 1', 1, 'tp-session-3',
      '{"schema":"tp-session-3"}'::jsonb
    )$$,
  '23505',
  'duplicate key value violates unique constraint "session_logs_canonical_identity_unique"',
  'a programme date and day has only one live canonical session'
);

select lives_ok(
  $$insert into public.programs (
      id, owner_id, title, schema_version, payload
    ) values (
      '10000000-0000-0000-0000-000000000103',
      '00000000-0000-0000-0000-000000000101',
      'User one second program', 'tp-program-2',
      '{"meta":{"schema":"tp-program-2"},"exercises":[]}'::jsonb
    )$$,
  'a user can insert their own program'
);

select throws_ok(
  $$insert into public.programs (
      owner_id, title, schema_version, payload
    ) values (
      '00000000-0000-0000-0000-000000000102',
      'Cross-owner insert', 'tp-program-2',
      '{"meta":{"schema":"tp-program-2"}}'::jsonb
    )$$,
  '42501',
  'new row violates row-level security policy for table "programs"',
  'a user cannot insert a program for another owner'
);

select results_eq(
  $$update public.programs set title = 'Hidden change'
    where id = '10000000-0000-0000-0000-000000000102'
    returning id$$,
  $$select null::uuid where false$$,
  'a user cannot update another owner program'
);

select throws_ok(
  $$update public.programs
    set owner_id = '00000000-0000-0000-0000-000000000102'
    where id = '10000000-0000-0000-0000-000000000101'$$,
  '42501',
  'permission denied for table programs',
  'owner_id is not client-updatable'
);

select throws_ok(
  $$delete from public.programs
    where id = '10000000-0000-0000-0000-000000000101'$$,
  '42501',
  'permission denied for table programs',
  'authenticated users cannot hard-delete programs'
);

select throws_ok(
  $$insert into public.session_logs (
      owner_id, program_id, session_date, day, week, schema_version, payload
    ) values (
      '00000000-0000-0000-0000-000000000101',
      '10000000-0000-0000-0000-000000000102',
      '2026-01-02', 'Day 1', 1, 'tp-session-3',
      '{"schema":"tp-session-3"}'::jsonb
    )$$,
  '23503',
  'insert or update on table "session_logs" violates foreign key constraint "session_logs_program_owner_fkey"',
  'a session cannot reference another owner program'
);

select throws_ok(
  $$insert into public.session_logs (
      owner_id, conflict_of, session_date, day, week, schema_version, payload
    ) values (
      '00000000-0000-0000-0000-000000000101',
      '20000000-0000-0000-0000-000000000102',
      '2026-01-02', 'Day 1', 1, 'tp-session-3',
      '{"schema":"tp-session-3"}'::jsonb
    )$$,
  '23503',
  'insert or update on table "session_logs" violates foreign key constraint "session_logs_conflict_owner_fkey"',
  'a conflict cannot reference another owner session'
);

select lives_ok(
  $$insert into public.session_logs (
      id, owner_id, program_id, conflict_of,
      session_date, day, week, schema_version, payload
    ) values (
      '20000000-0000-0000-0000-000000000103',
      '00000000-0000-0000-0000-000000000101',
      '10000000-0000-0000-0000-000000000101',
      '20000000-0000-0000-0000-000000000101',
      '2026-01-01', 'Day 1', 1, 'tp-session-3',
      '{"schema":"tp-session-3"}'::jsonb
    )$$,
  'a recoverable conflict can reference the same owner canonical session'
);

update public.session_logs
set payload = '{"schema":"tp-session-3","marker":"current"}'::jsonb
where id = '20000000-0000-0000-0000-000000000101';

select is(
  (select revision from public.session_logs
   where id = '20000000-0000-0000-0000-000000000101'),
  2::bigint,
  'a session update increments the revision'
);

select results_eq(
  $$update public.session_logs
    set payload = '{"schema":"tp-session-3","marker":"stale"}'::jsonb
    where id = '20000000-0000-0000-0000-000000000101' and revision = 1
    returning id$$,
  $$select null::uuid where false$$,
  'a stale session compare-and-swap changes no row'
);

update public.programs
set title = 'User one program updated'
where id = '10000000-0000-0000-0000-000000000101';

select is(
  (select revision from public.programs
   where id = '10000000-0000-0000-0000-000000000101'),
  2::bigint,
  'an update increments the revision'
);

select results_eq(
  $$update public.programs set title = 'Stale write'
    where id = '10000000-0000-0000-0000-000000000101' and revision = 1
    returning id$$,
  $$select null::uuid where false$$,
  'a stale compare-and-swap update changes no row'
);

update public.programs
set deleted_at = statement_timestamp()
where id = '10000000-0000-0000-0000-000000000101';

select ok(
  (select deleted_at is not null from public.programs
   where id = '10000000-0000-0000-0000-000000000101'),
  'users can create a visible soft-delete tombstone'
);

reset role;

delete from public.programs
where id = '10000000-0000-0000-0000-000000000102';

select is(
  (select count(*) from public.session_logs
   where owner_id = '00000000-0000-0000-0000-000000000102'),
  1::bigint,
  'hard program deletion retains its historical session'
);
select ok(
  (select program_id is null from public.session_logs
   where owner_id = '00000000-0000-0000-0000-000000000102'),
  'hard program deletion clears the historical program reference'
);

delete from auth.users
where id = '00000000-0000-0000-0000-000000000101';

select is(
  (select count(*) from public.programs
   where owner_id = '00000000-0000-0000-0000-000000000101'),
  0::bigint,
  'account deletion removes owned programs'
);
select is(
  (select count(*) from public.session_logs
   where owner_id = '00000000-0000-0000-0000-000000000101'),
  0::bigint,
  'account deletion removes owned session logs'
);
select is(
  (select count(*) from public.session_logs
   where owner_id = '00000000-0000-0000-0000-000000000102'),
  1::bigint,
  'account deletion leaves another owner data intact'
);

select * from finish();
rollback;
