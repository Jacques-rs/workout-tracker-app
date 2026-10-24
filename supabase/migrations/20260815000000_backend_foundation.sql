begin;

-- New public objects are private until a migration grants access deliberately.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

create schema if not exists private;
revoke all on schema private from public;

create function private.set_sync_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.created_at := statement_timestamp();
  else
    new.id := old.id;
    new.owner_id := old.owner_id;
    new.created_at := old.created_at;
    new.revision := old.revision + 1;
  end if;

  new.updated_at := statement_timestamp();
  return new;
end;
$$;

revoke all on function private.set_sync_metadata() from public;

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  title text not null,
  schema_version text not null,
  program_version integer not null default 0,
  payload jsonb not null,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint programs_id_owner_unique unique (id, owner_id),
  constraint programs_title_not_blank check (btrim(title) <> ''),
  constraint programs_schema_version_supported
    check (schema_version in ('tp-program-1', 'tp-program-2')),
  constraint programs_program_version_valid check (program_version >= 0),
  constraint programs_payload_is_object check (jsonb_typeof(payload) = 'object'),
  constraint programs_payload_schema_matches
    check (payload #>> '{meta,schema}' = schema_version),
  constraint programs_revision_valid check (revision > 0)
);

create table public.session_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  program_id uuid,
  conflict_of uuid,
  session_date date not null,
  day text not null,
  week integer not null,
  schema_version text not null,
  program_version integer not null default 0,
  payload jsonb not null,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint session_logs_id_owner_unique unique (id, owner_id),
  constraint session_logs_program_owner_fkey
    foreign key (program_id, owner_id)
    references public.programs (id, owner_id)
    on delete set null (program_id),
  constraint session_logs_conflict_owner_fkey
    foreign key (conflict_of, owner_id)
    references public.session_logs (id, owner_id)
    on delete set null (conflict_of),
  constraint session_logs_day_not_blank check (btrim(day) <> ''),
  constraint session_logs_week_valid check (week >= 1),
  constraint session_logs_schema_version_supported
    check (schema_version in ('tp-session-1', 'tp-session-2', 'tp-session-3')),
  constraint session_logs_program_version_valid check (program_version >= 0),
  constraint session_logs_payload_is_object check (jsonb_typeof(payload) = 'object'),
  constraint session_logs_payload_schema_matches
    check (payload ->> 'schema' = schema_version),
  constraint session_logs_revision_valid check (revision > 0),
  constraint session_logs_conflict_not_self check (conflict_of is null or conflict_of <> id)
);

create index programs_owner_updated_idx
  on public.programs (owner_id, updated_at, id);
create index session_logs_owner_updated_idx
  on public.session_logs (owner_id, updated_at, id);
create index session_logs_owner_date_idx
  on public.session_logs (owner_id, session_date desc, id);
create index session_logs_program_idx
  on public.session_logs (program_id) where program_id is not null;
create index session_logs_conflict_idx
  on public.session_logs (conflict_of) where conflict_of is not null;

create trigger programs_set_sync_metadata
before insert or update on public.programs
for each row execute function private.set_sync_metadata();

create trigger session_logs_set_sync_metadata
before insert or update on public.session_logs
for each row execute function private.set_sync_metadata();

alter table public.programs enable row level security;
alter table public.programs force row level security;
alter table public.session_logs enable row level security;
alter table public.session_logs force row level security;

create policy programs_select_own
on public.programs for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy programs_insert_own
on public.programs for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy programs_update_own
on public.programs for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy session_logs_select_own
on public.session_logs for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy session_logs_insert_own
on public.session_logs for insert
to authenticated
with check (
  (select auth.uid()) = owner_id
);

create policy session_logs_update_own
on public.session_logs for update
to authenticated
using ((select auth.uid()) = owner_id)
with check (
  (select auth.uid()) = owner_id
);

revoke all on table public.programs from public, anon, authenticated, service_role;
revoke all on table public.session_logs from public, anon, authenticated, service_role;

grant select, insert on table public.programs to authenticated;
grant update (title, schema_version, program_version, payload, deleted_at)
  on table public.programs to authenticated;

grant select, insert on table public.session_logs to authenticated;
grant update (
  program_id, conflict_of, session_date, day, week,
  schema_version, program_version, payload, deleted_at
) on table public.session_logs to authenticated;

grant select, insert, update, delete on table public.programs to service_role;
grant select, insert, update, delete on table public.session_logs to service_role;

commit;
