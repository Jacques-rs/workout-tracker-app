begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

-- The coach link: an administrator-created pair, read and written only through the
-- link-checked coach_* functions. See docs/backend.md, "The current boundary".
select ok(to_regclass('public.coach_athletes') is not null, 'coach_athletes table exists');
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.coach_athletes'::regclass),
  'coach_athletes has forced RLS'
);
select ok(not has_table_privilege('anon', 'public.coach_athletes', 'select'),
  'anonymous users cannot see links');
select ok(not has_table_privilege('authenticated', 'public.coach_athletes', 'insert'),
  'no account can link itself to an athlete');
select ok(not has_table_privilege('authenticated', 'public.coach_athletes', 'update'),
  'nor repoint an existing link');
select ok(has_table_privilege('authenticated', 'public.coach_athletes', 'delete'),
  'but either party can end one');

select ok(not has_function_privilege('anon', 'public.coach_athletes_linked()', 'execute'),
  'anonymous users cannot list linked athletes');
select ok(not has_function_privilege('anon', 'public.coach_session_logs(uuid, date)', 'execute'),
  'anonymous users cannot read through the coach functions');
select ok(not has_function_privilege('anon',
    'public.coach_revise_program(uuid, uuid, bigint, jsonb)', 'execute'),
  'anonymous users cannot write through the coach functions');
select ok(has_function_privilege('authenticated',
    'public.coach_publish_program(uuid, text, jsonb)', 'execute'),
  'an authenticated coach can call them, and the link decides the rest');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000301', 'coach@example.invalid'),
  ('00000000-0000-0000-0000-000000000302', 'athlete@example.invalid'),
  ('00000000-0000-0000-0000-000000000303', 'stranger@example.invalid');

insert into public.coach_athletes (coach_id, athlete_id) values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000302');

select throws_ok(
  $$insert into public.coach_athletes (coach_id, athlete_id) values
      ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000301')$$,
  '23514', null, 'nobody coaches themselves'
);

insert into public.programs (id, owner_id, title, schema_version, program_version, payload) values
  ('00000000-0000-0000-0000-000000000311', '00000000-0000-0000-0000-000000000301',
   'Coach own block', 'tp-program-2', 1, '{"meta":{"schema":"tp-program-2","version":1}}'),
  ('00000000-0000-0000-0000-000000000312', '00000000-0000-0000-0000-000000000302',
   'Athlete block', 'tp-program-2', 1, '{"meta":{"schema":"tp-program-2","version":1}}'),
  ('00000000-0000-0000-0000-000000000313', '00000000-0000-0000-0000-000000000303',
   'Stranger block', 'tp-program-2', 1, '{"meta":{"schema":"tp-program-2","version":1}}');

insert into public.session_logs
  (owner_id, program_id, session_date, day, week, schema_version, program_version, payload)
values
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000312',
   '2026-10-19', 'Day 1', 1, 'tp-session-3', 1, '{"schema":"tp-session-3"}'),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000312',
   '2026-10-21', 'Day 2', 1, 'tp-session-3', 1, '{"schema":"tp-session-3"}'),
  ('00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000313',
   '2026-10-19', 'Day 1', 1, 'tp-session-3', 1, '{"schema":"tp-session-3"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000301', true);

-- The coach trains in the app too, and the app lists both tables through RLS alone. The
-- link must never widen what those queries return.
select is((select count(*) from public.programs), 1::bigint,
  'a coach still sees only their own programmes in their own library');
select is((select count(*) from public.session_logs), 0::bigint,
  'and none of a linked athlete sessions');

select is((select email from public.coach_athletes_linked()), 'athlete@example.invalid',
  'a coach lists the athletes linked to them');
select is((select count(*) from public.coach_session_logs('00000000-0000-0000-0000-000000000302')),
  2::bigint, 'and reads a linked athlete sessions');
select is((select count(*) from public.coach_session_logs(
    '00000000-0000-0000-0000-000000000302', '2026-10-19')),
  1::bigint, 'only those after the reviewed-through date when one is given');
select is((select title from public.coach_programs('00000000-0000-0000-0000-000000000302')),
  'Athlete block', 'and that athlete programmes');

select throws_ok(
  $$select * from public.coach_session_logs('00000000-0000-0000-0000-000000000303')$$,
  '42501', 'not a coach of this athlete', 'an unlinked athlete sessions are refused'
);
select throws_ok(
  $$select * from public.coach_programs('00000000-0000-0000-0000-000000000303')$$,
  '42501', 'not a coach of this athlete', 'as are their programmes'
);
select throws_ok(
  $$select * from public.coach_publish_program('00000000-0000-0000-0000-000000000303',
      'Pushed', '{"meta":{"schema":"tp-program-2","version":1}}')$$,
  '42501', 'not a coach of this athlete', 'and nothing can be published into their library'
);
select throws_ok(
  $$insert into public.coach_athletes (coach_id, athlete_id) values
      ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000303')$$,
  '42501', null, 'a coach cannot link a new athlete themselves'
);

select lives_ok(
  $$select * from public.coach_publish_program('00000000-0000-0000-0000-000000000302',
      'Next block', '{"meta":{"schema":"tp-program-2","version":1}}')$$,
  'a coach publishes a new block to a linked athlete'
);
select is(
  (select revision from public.coach_revise_program(
     '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000312', 1,
     '{"meta":{"schema":"tp-program-2","version":2}}')),
  2::bigint, 'and revises an existing one from the revision they read'
);
select throws_ok(
  $$select * from public.coach_revise_program(
      '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000312', 1,
      '{"meta":{"schema":"tp-program-2","version":3}}')$$,
  '40001', 'programme changed or was removed since it was read',
  'a revision from a stale read is refused rather than overwriting'
);
select throws_ok(
  $$select * from public.coach_revise_program(
      '00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000313', 1,
      '{"meta":{"schema":"tp-program-2","version":2}}')$$,
  '42501', 'not a coach of this athlete', 'an unlinked athlete programme cannot be revised'
);
select throws_ok(
  $$select * from public.coach_revise_program(
      '00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000313', 1,
      '{"meta":{"schema":"tp-program-2","version":2}}')$$,
  '40001', 'programme changed or was removed since it was read',
  'nor reached by pairing a linked athlete with another owner programme id'
);
reset role;

select is(
  (select owner_id from public.programs where title = 'Next block'),
  '00000000-0000-0000-0000-000000000302'::uuid,
  'a published block belongs to the athlete, not the coach'
);
select is(
  (select program_version from public.programs
   where id = '00000000-0000-0000-0000-000000000312'),
  2, 'a revision carries the payload version into the metadata column'
);
select is(
  (select program_version from public.programs
   where id = '00000000-0000-0000-0000-000000000313'),
  1, 'and the other owner programme is untouched'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000303', true);
select throws_ok(
  $$select * from public.coach_session_logs('00000000-0000-0000-0000-000000000302')$$,
  '42501', 'not a coach of this athlete', 'another athlete cannot read through the coach functions'
);
select is((select count(*) from public.coach_athletes), 0::bigint,
  'nor see a link they are not part of');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000302', true);
select is((select count(*) from public.coach_athletes), 1::bigint,
  'an athlete sees who coaches them');
select lives_ok($$delete from public.coach_athletes$$, 'and can end the link');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000301', true);
select throws_ok(
  $$select * from public.coach_programs('00000000-0000-0000-0000-000000000302')$$,
  '42501', 'not a coach of this athlete', 'after which the coach loses access at once'
);
reset role;

select * from finish();
rollback;
