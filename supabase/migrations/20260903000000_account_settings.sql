begin;

-- Which optional fields an athlete tracks, and what they call them, belong to the
-- ACCOUNT rather than the device: signing in on a second phone must not silently stop
-- collecting the tendon protocol's readings, and it must not rename them either.
--
-- Appearance and anything else about where the athlete is standing — palette, light/dark,
-- which view the app opens on — stay device-local and are never sent here. See
-- "Tracked fields are account-scoped" in docs/design-rationale.md.
--
-- One row per owner, deliberately: this is a handful of preferences, not a log. The
-- conflict rule is LAST WRITE WINS PER FIELD, which is why the timestamps live beside
-- the values in their own object. A tracked-fields change made offline on two devices is
-- not worth a conflict copy — unlike a workout, nothing is lost by resolving it, and the
-- athlete can see and re-set it in one tap.
create table public.user_settings (
  owner_id uuid primary key default auth.uid()
    references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  field_updated_at jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_settings_settings_is_object check (jsonb_typeof(settings) = 'object'),
  constraint user_settings_stamps_is_object check (jsonb_typeof(field_updated_at) = 'object'),
  -- A preferences record is small by construction. The bound is here so a client bug
  -- cannot turn a settings row into unbounded storage.
  constraint user_settings_settings_bounded check (length(settings::text) <= 8192),
  constraint user_settings_stamps_bounded check (length(field_updated_at::text) <= 8192),
  constraint user_settings_revision_valid check (revision > 0)
);

-- Owner and creation time are immutable, and the revision only ever moves forward: the
-- same trigger the programme and session tables use, so every synced table behaves the
-- same way under an update.
create function private.set_settings_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.created_at := statement_timestamp();
  else
    new.owner_id := old.owner_id;
    new.created_at := old.created_at;
    new.revision := old.revision + 1;
  end if;

  new.updated_at := statement_timestamp();
  return new;
end;
$$;

revoke all on function private.set_settings_metadata() from public;

create trigger user_settings_set_metadata
before insert or update on public.user_settings
for each row execute function private.set_settings_metadata();

alter table public.user_settings enable row level security;
alter table public.user_settings force row level security;

create policy user_settings_select_own
on public.user_settings for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy user_settings_insert_own
on public.user_settings for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy user_settings_update_own
on public.user_settings for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

revoke all on table public.user_settings from public, anon, authenticated, service_role;

-- No delete for the athlete: clearing a preference is a write, and the row goes with the
-- account through the auth.users cascade.
grant select, insert on table public.user_settings to authenticated;
grant update (settings, field_updated_at) on table public.user_settings to authenticated;
grant select, insert, update, delete on table public.user_settings to service_role;

-- The account export has to carry these too, or "export account data" would quietly omit
-- the athlete's own tracked-field choices. Replaced rather than extended in place,
-- because a stable invoker function is the whole point of the export boundary.
create or replace function public.export_own_account()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'account', jsonb_build_object('id', auth.uid(), 'email', auth.jwt() ->> 'email'),
    'settings', coalesce((
      select jsonb_build_object(
        'values', us.settings, 'fieldUpdatedAt', us.field_updated_at,
        'revision', us.revision, 'createdAt', us.created_at, 'updatedAt', us.updated_at
      )
      from public.user_settings us where us.owner_id = auth.uid()
    ), 'null'::jsonb),
    'programmes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'title', p.title, 'schemaVersion', p.schema_version,
        'programVersion', p.program_version, 'payload', p.payload, 'revision', p.revision,
        'createdAt', p.created_at, 'updatedAt', p.updated_at, 'deletedAt', p.deleted_at
      ) order by p.created_at, p.id)
      from public.programs p where p.owner_id = auth.uid()
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'programId', s.program_id, 'conflictOf', s.conflict_of,
        'date', s.session_date, 'day', s.day, 'week', s.week,
        'schemaVersion', s.schema_version, 'programVersion', s.program_version,
        'payload', s.payload, 'revision', s.revision, 'createdAt', s.created_at,
        'updatedAt', s.updated_at, 'deletedAt', s.deleted_at
      ) order by s.created_at, s.id)
      from public.session_logs s where s.owner_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.export_own_account() from public, anon;
grant execute on function public.export_own_account() to authenticated;

commit;
