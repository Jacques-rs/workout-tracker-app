begin;

-- Explicit consent to process health data, which the privacy notice relies on. One row per
-- decision, append-only, so the account can show when consent was given, declined or
-- withdrawn and under which consent terms. The latest decision is the one in force. See
-- "Health-data consent" in docs/backend.md.
create table public.health_consents (
  -- Generated on the phone, so a decision made offline and retried is stored once.
  id uuid primary key,
  owner_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  action text not null,
  consent_version integer not null,
  decided_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  constraint health_consents_action_valid check (action in ('given', 'declined', 'withdrawn')),
  constraint health_consents_version_valid check (consent_version > 0)
);

create index health_consents_owner_latest_idx
  on public.health_consents (owner_id, decided_at desc, recorded_at desc);

-- The server stamps when it heard about a decision, and a phone clock running ahead cannot
-- date one into the future, where it would outrank every later real decision.
create function private.set_health_consent_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.recorded_at := statement_timestamp();
  if new.decided_at > new.recorded_at then
    new.decided_at := new.recorded_at;
  end if;
  return new;
end;
$$;

revoke all on function private.set_health_consent_metadata() from public;

create trigger health_consents_set_metadata
before insert on public.health_consents
for each row execute function private.set_health_consent_metadata();

alter table public.health_consents enable row level security;
alter table public.health_consents force row level security;

create policy health_consents_select_own
on public.health_consents for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy health_consents_insert_own
on public.health_consents for insert
to authenticated
with check ((select auth.uid()) = owner_id);

-- No update or delete for the athlete: changing your mind is a new row, and the record of
-- what was agreed when is the point. Rows go with the account through the cascade.
revoke all on table public.health_consents from public, anon, authenticated, service_role;
grant select, insert on table public.health_consents to authenticated;
grant select, insert, update, delete on table public.health_consents to service_role;

-- Bumped, in a migration, together with CONSENT_VERSION in index.html, and only when the
-- health-data terms change. A decision under an older version no longer counts as given.
create function private.health_consent_version()
returns integer
language sql
immutable
set search_path = ''
as $$ select 1 $$;

revoke all on function private.health_consent_version() from public;

create function private.health_consent_given(athlete uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select c.action = 'given' and c.consent_version >= private.health_consent_version()
    from public.health_consents c
    where c.owner_id = athlete
    order by c.decided_at desc, c.recorded_at desc, c.id desc
    limit 1
  ), false);
$$;

revoke all on function private.health_consent_given(uuid) from public;

-- Blanks the health readings in a session payload of any tp-session version and marks them
-- untracked, so a reader sees "not tracked" rather than a clean week. Readiness is training
-- data and stays. Every logged value is a string, so a blanked one is "", never null.
create function private.strip_health_entry(entry jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(entry) <> 'object' then entry else
    entry
    || case when entry ? 'painDuring' then '{"painDuring":""}'::jsonb else '{}'::jsonb end
    || case when jsonb_typeof(entry -> 'sets') = 'array' then jsonb_build_object('sets', (
         select coalesce(jsonb_agg(
           case when jsonb_typeof(s) = 'object' and s ? 'painDuring'
                then s || '{"painDuring":""}'::jsonb else s end
           order by n), '[]'::jsonb)
         from jsonb_array_elements(entry -> 'sets') with ordinality as t (s, n)))
       else '{}'::jsonb end
  end;
$$;

revoke all on function private.strip_health_entry(jsonb) from public;

create function private.strip_health(payload jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select payload
    || case when jsonb_typeof(payload -> 'session') = 'object' then jsonb_build_object('session',
         (payload -> 'session') || (
           select coalesce(jsonb_object_agg(k, ''), '{}'::jsonb)
           from unnest(array['bodyweightKg', 'sleep', 'hrvNote', 'amPainOnWaking', 'amPainNextDay']) as k
           where (payload -> 'session') ? k))
       else '{}'::jsonb end
    || case when jsonb_typeof(payload -> 'tracking') = 'object' then jsonb_build_object('tracking',
         (payload -> 'tracking') || (
           select coalesce(jsonb_object_agg(k, false), '{}'::jsonb)
           from unnest(array['painPerExercise', 'painOnWaking', 'painNextMorning', 'sleep',
                             'bodyweight', 'hrvNote']) as k
           where (payload -> 'tracking') ? k))
       else '{}'::jsonb end
    || case when jsonb_typeof(payload -> 'entries') = 'array' then jsonb_build_object('entries', (
         select coalesce(jsonb_agg(private.strip_health_entry(e) order by n), '[]'::jsonb)
         from jsonb_array_elements(payload -> 'entries') with ordinality as t (e, n)))
       else '{}'::jsonb end;
$$;

revoke all on function private.strip_health(jsonb) from public;

-- Without consent in force the coach still sees training, never health readings — past
-- logs included, because withdrawal stops any further use.
create or replace function public.coach_session_logs(athlete uuid, since date default null)
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
declare
  consented boolean;
begin
  perform private.require_coach_of(athlete);
  consented := private.health_consent_given(athlete);
  return query
    select s.id, s.program_id, s.conflict_of, s.session_date, s.day, s.week,
           s.schema_version, s.program_version,
           case when consented then s.payload else private.strip_health(s.payload) end,
           s.revision, s.updated_at
    from public.session_logs s
    where s.owner_id = athlete and s.deleted_at is null
      and (since is null or s.session_date > since)
    order by s.session_date, s.updated_at, s.id;
end;
$$;

-- The account export carries every consent decision, so a copy of your data shows what
-- you agreed to and when.
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
    'healthConsents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'action', c.action, 'consentVersion', c.consent_version,
        'decidedAt', c.decided_at, 'recordedAt', c.recorded_at
      ) order by c.decided_at, c.recorded_at, c.id)
      from public.health_consents c where c.owner_id = auth.uid()
    ), '[]'::jsonb),
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
