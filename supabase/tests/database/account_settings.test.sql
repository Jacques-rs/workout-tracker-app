begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

-- The account-scoped settings row: one per owner, reachable only by that owner, and
-- carried by the account export. See docs/design-rationale.md, "Tracked fields are
-- account-scoped".
select ok(to_regclass('public.user_settings') is not null, 'user_settings table exists');
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class where oid = 'public.user_settings'::regclass),
  'user_settings has forced RLS'
);
select ok(not has_table_privilege('anon', 'public.user_settings', 'select'),
  'anonymous users cannot read anyone settings');
select ok(not has_table_privilege('anon', 'public.user_settings', 'insert'),
  'anonymous users cannot write settings');
select ok(has_table_privilege('authenticated', 'public.user_settings', 'select'),
  'authenticated users reach their settings through RLS');
select ok(not has_table_privilege('authenticated', 'public.user_settings', 'delete'),
  'clearing a preference is a write, not a delete');
select ok(has_column_privilege('authenticated', 'public.user_settings', 'settings', 'update'),
  'an athlete can update their own preference values');
select ok(not has_column_privilege('authenticated', 'public.user_settings', 'owner_id', 'update'),
  'but never reassign the row to another account');
select ok(not has_column_privilege('authenticated', 'public.user_settings', 'revision', 'update'),
  'and never set the revision by hand');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000201', 'settings-one@example.invalid'),
  ('00000000-0000-0000-0000-000000000202', 'settings-two@example.invalid');

insert into public.user_settings (owner_id, settings, field_updated_at) values
  (
    '00000000-0000-0000-0000-000000000201',
    '{"painOnWaking":true,"painLabel":"Knee"}'::jsonb,
    '{"painOnWaking":"2026-09-01T06:00:00.000Z","painLabel":"2026-09-01T06:00:00.000Z"}'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000202',
    '{"painOnWaking":false}'::jsonb,
    '{"painOnWaking":"2026-09-02T06:00:00.000Z"}'::jsonb
  );

select is((select revision from public.user_settings
           where owner_id = '00000000-0000-0000-0000-000000000201'),
  1::bigint, 'a new settings row starts at revision 1');

-- A preferences record is small by construction, and the bound is enforced rather than
-- assumed: a client bug must not be able to turn it into unbounded storage.
select throws_ok(
  $$insert into public.user_settings (owner_id, settings) values
      ('00000000-0000-0000-0000-000000000201', '[]'::jsonb)$$,
  '23514',
  'new row for relation "user_settings" violates check constraint "user_settings_settings_is_object"',
  'settings must be an object, never an array or a scalar'
);
select throws_ok(
  $$insert into public.user_settings (owner_id, settings) values
      ('00000000-0000-0000-0000-000000000201',
       jsonb_build_object('painLabel', repeat('x', 9000)))$$,
  '23514',
  'new row for relation "user_settings" violates check constraint "user_settings_settings_bounded"',
  'and it cannot grow past a few kilobytes'
);
select throws_ok(
  $$insert into public.user_settings (owner_id, settings) values
      ('00000000-0000-0000-0000-000000000201', '{}'::jsonb)$$,
  '23505',
  'duplicate key value violates unique constraint "user_settings_pkey"',
  'an owner has exactly one settings row'
);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000201';

select is((select count(*) from public.user_settings), 1::bigint,
  'an athlete sees only their own settings row');
select is((select settings ->> 'painLabel' from public.user_settings), 'Knee',
  'and reads their own values back');

select lives_ok(
  $$update public.user_settings
       set settings = '{"painOnWaking":true,"painLabel":"Left knee"}'::jsonb,
           field_updated_at = '{"painOnWaking":"2026-09-01T06:00:00.000Z","painLabel":"2026-09-03T06:00:00.000Z"}'::jsonb$$,
  'an athlete can rewrite their own settings'
);
select is((select revision from public.user_settings), 2::bigint,
  'which moves the revision forward on its own');

-- Another owner's row is invisible, so an update aimed at it changes nothing rather than
-- failing loudly — that is what RLS is for.
select is(
  (select count(*) from public.user_settings
   where owner_id = '00000000-0000-0000-0000-000000000202'),
  0::bigint,
  'another athlete settings row is not visible at all'
);
select lives_ok(
  $$update public.user_settings set settings = '{"painOnWaking":false}'::jsonb
     where owner_id = '00000000-0000-0000-0000-000000000202'$$,
  'an update aimed at another owner is simply a no-op'
);
reset role;
select is((select settings ->> 'painOnWaking' from public.user_settings
           where owner_id = '00000000-0000-0000-0000-000000000202'),
  'false', 'and that row is untouched');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-0000-0000-000000000201',
  'email', 'settings-one@example.invalid',
  'role', 'authenticated'
)::text, true);

-- Export account data must carry the athlete's own tracked-field choices, or it would
-- quietly omit them.
select is(
  public.export_own_account() #>> '{settings,values,painLabel}',
  'Left knee',
  'the account export carries the account-scoped settings'
);
select is(
  public.export_own_account() #>> '{settings,fieldUpdatedAt,painLabel}',
  '2026-09-03T06:00:00.000Z',
  'including the per-field timestamps the merge depends on'
);
reset role;

delete from auth.users where id = '00000000-0000-0000-0000-000000000201';
select is((select count(*) from public.user_settings
           where owner_id = '00000000-0000-0000-0000-000000000201'),
  0::bigint, 'account deletion removes the settings row with the account');
select is((select count(*) from public.user_settings), 1::bigint,
  'and leaves another owner settings intact');

select * from finish();
rollback;
