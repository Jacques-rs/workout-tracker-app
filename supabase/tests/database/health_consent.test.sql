begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

-- Health-data consent: an append-only record per owner, and a coach who sees health
-- readings only while consent is in force. See docs/backend.md, "Health-data consent".
select ok(to_regclass('public.health_consents') is not null, 'health_consents table exists');
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.health_consents'::regclass),
  'health_consents has forced RLS'
);
select ok(not has_table_privilege('anon', 'public.health_consents', 'select'),
  'anonymous users cannot read anyone consent');
select ok(not has_table_privilege('anon', 'public.health_consents', 'insert'),
  'anonymous users cannot record consent');
select ok(has_table_privilege('authenticated', 'public.health_consents', 'insert'),
  'an athlete records their own decisions');
select ok(not has_table_privilege('authenticated', 'public.health_consents', 'update'),
  'but never rewrites one');
select ok(not has_table_privilege('authenticated', 'public.health_consents', 'delete'),
  'nor deletes one');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000401', 'consent-coach@example.invalid'),
  ('00000000-0000-0000-0000-000000000402', 'consent-athlete@example.invalid'),
  ('00000000-0000-0000-0000-000000000403', 'consent-other@example.invalid');

insert into public.coach_athletes (coach_id, athlete_id) values
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000402');

insert into public.programs (id, owner_id, title, schema_version, program_version, payload) values
  ('00000000-0000-0000-0000-000000000412', '00000000-0000-0000-0000-000000000402',
   'Athlete block', 'tp-program-2', 1, '{"meta":{"schema":"tp-program-2","version":1}}');

insert into public.session_logs
  (owner_id, program_id, session_date, day, week, schema_version, program_version, payload)
values
  ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000412',
   '2026-10-19', 'Day 1', 1, 'tp-session-3', 1, $${
     "schema":"tp-session-3",
     "tracking":{"painLabel":"Knee","painPerExercise":true,"painOnWaking":true,
       "readiness":true,"sleep":true,"bodyweight":true,"hrvNote":true,"perSetLogging":true},
     "session":{"bodyweightKg":"88","sleep":"4","readiness":"Green","hrvNote":"HRV 62",
       "amPainOnWaking":"3","overall":"Good day"},
     "entries":[{"exercise":"Squat","load":"100","reps":"5","rpe":"8","painDuring":"2",
       "notes":"ok","sets":[{"set":1,"load":"100","reps":"5","rpe":"8","painDuring":"2","note":""}]}]
   }$$);

-- What a coach reads, flattened to the readings that matter here.
create function pg_temp.coach_view()
returns jsonb language sql as $$
  select jsonb_build_object(
    'bodyweight', payload #>> '{session,bodyweightKg}',
    'sleep', payload #>> '{session,sleep}',
    'readiness', payload #>> '{session,readiness}',
    'hrv', payload #>> '{session,hrvNote}',
    'waking', payload #>> '{session,amPainOnWaking}',
    'pain', payload #>> '{entries,0,painDuring}',
    'setPain', payload #>> '{entries,0,sets,0,painDuring}',
    'load', payload #>> '{entries,0,sets,0,load}',
    'tracksPain', payload #> '{tracking,painPerExercise}',
    'tracksReadiness', payload #> '{tracking,readiness}')
  from public.coach_session_logs('00000000-0000-0000-0000-000000000402');
$$;
grant execute on function pg_temp.coach_view() to authenticated;

set local role authenticated;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
select is(pg_temp.coach_view(),
  '{"bodyweight":"","sleep":"","readiness":"Green","hrv":"","waking":"","pain":"",
    "setPain":"","load":"100","tracksPain":false,"tracksReadiness":true}'::jsonb,
  'with no decision on record, a coach sees training and readiness but no health reading');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000402', true);
select lives_ok(
  $$insert into public.health_consents (id, action, consent_version, decided_at) values
      ('00000000-0000-0000-0000-000000000421', 'given', 1, '2026-10-20T06:00:00Z')$$,
  'an athlete records consent');
select throws_ok(
  $$insert into public.health_consents (id, owner_id, action, consent_version, decided_at) values
      ('00000000-0000-0000-0000-000000000422', '00000000-0000-0000-0000-000000000403',
       'given', 1, now())$$,
  '42501', null, 'but never on behalf of another account');
select throws_ok(
  $$update public.health_consents set action = 'withdrawn'$$,
  '42501', null, 'and a decision cannot be rewritten after the fact');
select throws_ok(
  $$delete from public.health_consents$$,
  '42501', null, 'or erased');
select throws_ok(
  $$insert into public.health_consents (id, action, consent_version, decided_at) values
      ('00000000-0000-0000-0000-000000000423', 'maybe', 1, now())$$,
  '23514', null, 'only given, declined or withdrawn are decisions');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
select is(pg_temp.coach_view(),
  '{"bodyweight":"88","sleep":"4","readiness":"Green","hrv":"HRV 62","waking":"3","pain":"2",
    "setPain":"2","load":"100","tracksPain":true,"tracksReadiness":true}'::jsonb,
  'with consent in force, the coach sees the log as the athlete wrote it');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000402', true);
insert into public.health_consents (id, action, consent_version, decided_at) values
  ('00000000-0000-0000-0000-000000000424', 'withdrawn', 1, '2026-10-22T06:00:00Z');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
select is(pg_temp.coach_view() ->> 'pain', '',
  'withdrawal stops the coach seeing health readings, in logs from before it too');

-- A phone clock running ahead cannot date a decision past every later real one.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000402', true);
insert into public.health_consents (id, action, consent_version, decided_at) values
  ('00000000-0000-0000-0000-000000000425', 'given', 1, '2099-01-01T00:00:00Z');
select ok(
  (select decided_at <= recorded_at from public.health_consents
   where id = '00000000-0000-0000-0000-000000000425'),
  'a decision dated in the future is clamped to when the server heard it');
-- Decided offline, earlier than the clamped one: it arrives later but does not outrank it.
insert into public.health_consents (id, action, consent_version, decided_at) values
  ('00000000-0000-0000-0000-000000000426', 'withdrawn', 1, '2026-10-23T06:00:00Z');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000401', true);
select is(pg_temp.coach_view() ->> 'pain', '2',
  'the latest decision by when it was made is the one in force, not the last to sync');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000403', true);
select is((select count(*) from public.health_consents), 0::bigint,
  'another account sees none of an athlete decisions');
select is(public.export_own_account() -> 'healthConsents', '[]'::jsonb,
  'and exports none of them');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000402', true);
select is(jsonb_array_length(public.export_own_account() -> 'healthConsents'), 4,
  'the account export carries every decision the athlete made');
select is(public.export_own_account() #>> '{healthConsents,0,action}', 'given',
  'oldest first');
reset role;

-- Older log versions are stripped too: v1 has no tracking block and names its morning
-- field amPainNextDay.
select is(
  private.strip_health('{"schema":"tp-session-1","session":{"amPainNextDay":"4","readiness":"Amber"},
    "entries":[{"painDuring":"5"}]}'::jsonb),
  '{"schema":"tp-session-1","session":{"amPainNextDay":"","readiness":"Amber"},
    "entries":[{"painDuring":""}]}'::jsonb,
  'a v1 log loses its pain readings and keeps readiness');
select is(
  private.strip_health('{"schema":"tp-session-2","tracking":{"painNextMorning":true,"readiness":true}}'::jsonb)
    -> 'tracking',
  '{"painNextMorning":false,"readiness":true}'::jsonb,
  'a v2 log has only the switches it already carried marked untracked');

select * from finish();
rollback;
