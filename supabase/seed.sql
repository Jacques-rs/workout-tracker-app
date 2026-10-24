-- Development-only fixtures. These users cannot sign in and all content is invented.
insert into auth.users (id, email, raw_user_meta_data)
values
  ('00000000-0000-0000-0000-000000000001', 'athlete-one@example.invalid', '{}'),
  ('00000000-0000-0000-0000-000000000002', 'athlete-two@example.invalid', '{}')
on conflict (id) do nothing;

insert into public.programs (
  id, owner_id, title, schema_version, program_version, payload
)
values
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'Sample strength block',
    'tp-program-2',
    1,
    '{
      "meta": {
        "block": "Sample strength block",
        "athlete": "Athlete One",
        "athleteId": "athlete-one",
        "weeks": 1,
        "version": 1,
        "days": ["Day 1 - Sample"],
        "schema": "tp-program-2"
      },
      "exercises": [
        {
          "id": "w1-d1-e1",
          "week": 1,
          "day": "Day 1 - Sample",
          "name": "Sample squat",
          "sets": "3",
          "reps": "5",
          "load": "Comfortable",
          "rpe": "RPE 6"
        }
      ]
    }'::jsonb
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000002',
    'Sample conditioning block',
    'tp-program-2',
    1,
    '{
      "meta": {
        "block": "Sample conditioning block",
        "athlete": "Athlete Two",
        "athleteId": "athlete-two",
        "weeks": 1,
        "version": 1,
        "days": ["Day 1 - Sample"],
        "schema": "tp-program-2"
      },
      "exercises": []
    }'::jsonb
  )
on conflict (id) do nothing;

insert into public.session_logs (
  id, owner_id, program_id, session_date, day, week,
  schema_version, program_version, payload
)
values (
  '20000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '2026-01-01',
  'Day 1 - Sample',
  1,
  'tp-session-3',
  1,
  '{
    "schema": "tp-session-3",
    "block": "Sample strength block",
    "athlete": "Athlete One",
    "athleteId": "athlete-one",
    "programVersion": 1,
    "week": 1,
    "day": "Day 1 - Sample",
    "date": "2026-01-01",
    "exportedAt": "2026-01-01T12:00:00.000Z",
    "tracking": {
      "painLabel": "",
      "painPerExercise": false,
      "painOnWaking": false,
      "readiness": false,
      "sleep": false,
      "bodyweight": false,
      "hrvNote": false,
      "perSetLogging": true
    },
    "session": {
      "bodyweightKg": "",
      "sleep": "",
      "readiness": "",
      "hrvNote": "",
      "amPainOnWaking": "",
      "overall": ""
    },
    "entries": []
  }'::jsonb
)
on conflict (id) do nothing;
