begin;

-- A coach reaches a linked athlete's rows only through the coach_* functions below. The
-- programs and session_logs policies stay owner-only on purpose: the app lists both tables
-- through RLS alone, so a coach policy there would put an athlete's programmes and sessions
-- into the coach's own library.
create table public.coach_athletes (
  coach_id uuid not null references auth.users (id) on delete cascade,
  athlete_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (coach_id, athlete_id),
  constraint coach_athletes_not_self check (coach_id <> athlete_id)
);

create index coach_athletes_athlete_idx on public.coach_athletes (athlete_id);

alter table public.coach_athletes enable row level security;
alter table public.coach_athletes force row level security;

create policy coach_athletes_select_party
on public.coach_athletes for select
to authenticated
using ((select auth.uid()) in (coach_id, athlete_id));

-- Either side can end a link; only an administrator creates one, because a self-service
-- insert would let any account coach any other.
create policy coach_athletes_delete_party
on public.coach_athletes for delete
to authenticated
using ((select auth.uid()) in (coach_id, athlete_id));

revoke all on table public.coach_athletes from public, anon, authenticated, service_role;
grant select, delete on table public.coach_athletes to authenticated;
grant select, insert, update, delete on table public.coach_athletes to service_role;

create function private.require_coach_of(athlete uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.coach_athletes l
    where l.coach_id = auth.uid() and l.athlete_id = athlete
  ) then
    raise exception 'not a coach of this athlete' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.require_coach_of(uuid) from public;

create function private.payload_program_version(payload jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(payload #> '{meta,version}') = 'number'
              then (payload #>> '{meta,version}')::numeric::integer else 0 end;
$$;
revoke all on function private.payload_program_version(jsonb) from public;

create function public.coach_athletes_linked()
returns table (athlete_id uuid, email text, linked_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select l.athlete_id, u.email::text, l.created_at
  from public.coach_athletes l join auth.users u on u.id = l.athlete_id
  where l.coach_id = auth.uid()
  order by l.created_at;
$$;

create function public.coach_session_logs(athlete uuid, since date default null)
returns table (
  id uuid, program_id uuid, conflict_of uuid, session_date date, day text, week integer,
  schema_version text, program_version integer, payload jsonb, revision bigint,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_coach_of(athlete);
  return query
    select s.id, s.program_id, s.conflict_of, s.session_date, s.day, s.week,
           s.schema_version, s.program_version, s.payload, s.revision, s.updated_at
    from public.session_logs s
    where s.owner_id = athlete and s.deleted_at is null
      and (since is null or s.session_date > since)
    order by s.session_date, s.updated_at, s.id;
end;
$$;

create function public.coach_programs(athlete uuid)
returns table (
  id uuid, title text, schema_version text, program_version integer, payload jsonb,
  revision bigint, updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_coach_of(athlete);
  return query
    select p.id, p.title, p.schema_version, p.program_version, p.payload, p.revision,
           p.updated_at
    from public.programs p
    where p.owner_id = athlete and p.deleted_at is null
    order by p.updated_at desc, p.id;
end;
$$;

-- A published block lands in the athlete's library inactive; activating it stays the
-- athlete's tap on their own device.
create function public.coach_publish_program(athlete uuid, title text, payload jsonb)
returns table (id uuid, revision bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  published_id uuid;
  published_revision bigint;
begin
  perform private.require_coach_of(athlete);
  insert into public.programs as p (owner_id, title, schema_version, program_version, payload)
  values (athlete, coach_publish_program.title,
          coach_publish_program.payload #>> '{meta,schema}',
          private.payload_program_version(coach_publish_program.payload),
          coach_publish_program.payload)
  returning p.id, p.revision into published_id, published_revision;
  return query select published_id, published_revision;
end;
$$;

-- Guarded by the revision the coach last read, like every other write to this table: a
-- zero-row update means the row changed since, and the coach must re-read, not overwrite.
create function public.coach_revise_program(
  athlete uuid, program uuid, expected_revision bigint, payload jsonb
)
returns table (id uuid, revision bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  revised_id uuid;
  revised_revision bigint;
begin
  perform private.require_coach_of(athlete);
  update public.programs p
     set payload = coach_revise_program.payload,
         schema_version = coach_revise_program.payload #>> '{meta,schema}',
         program_version = private.payload_program_version(coach_revise_program.payload)
   where p.id = program and p.owner_id = athlete and p.deleted_at is null
     and p.revision = expected_revision
  returning p.id, p.revision into revised_id, revised_revision;
  if revised_id is null then
    raise exception 'programme changed or was removed since it was read' using errcode = '40001';
  end if;
  return query select revised_id, revised_revision;
end;
$$;

revoke all on function public.coach_athletes_linked() from public, anon;
revoke all on function public.coach_session_logs(uuid, date) from public, anon;
revoke all on function public.coach_programs(uuid) from public, anon;
revoke all on function public.coach_publish_program(uuid, text, jsonb) from public, anon;
revoke all on function public.coach_revise_program(uuid, uuid, bigint, jsonb) from public, anon;
grant execute on function public.coach_athletes_linked() to authenticated;
grant execute on function public.coach_session_logs(uuid, date) to authenticated;
grant execute on function public.coach_programs(uuid) to authenticated;
grant execute on function public.coach_publish_program(uuid, text, jsonb) to authenticated;
grant execute on function public.coach_revise_program(uuid, uuid, bigint, jsonb) to authenticated;

commit;
