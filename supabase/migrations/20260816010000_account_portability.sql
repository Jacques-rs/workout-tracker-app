begin;

-- The export is deliberately an invoker function: normal RLS remains the access
-- boundary and one SQL statement provides a single transaction snapshot.
create function public.export_own_account()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'account', jsonb_build_object('id', auth.uid(), 'email', auth.jwt() ->> 'email'),
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

-- SECURITY DEFINER is necessary only for removing auth.users. It never accepts an
-- id, uses an empty path, and demands a fresh password AMR from the caller's JWT.
create function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  password_verified boolean;
begin
  if caller is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) claim
    where claim ->> 'method' = 'password'
      and claim ->> 'timestamp' ~ '^[0-9]+$'
      and to_timestamp((claim ->> 'timestamp')::double precision) >= statement_timestamp() - interval '5 minutes'
  ) into password_verified;
  if not password_verified then
    raise exception 'recent password authentication is required' using errcode = '42501';
  end if;
  delete from auth.users where id = caller;
end;
$$;

revoke all on function public.export_own_account() from public, anon;
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.export_own_account() to authenticated;
grant execute on function public.delete_own_account() to authenticated;

create function private.purge_expired_programme_tombstones()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare removed integer;
begin
  delete from public.programs
   where deleted_at is not null
     and deleted_at < statement_timestamp() - interval '30 days';
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function private.purge_expired_programme_tombstones() from public;

create extension if not exists pg_cron with schema extensions;
select cron.schedule(
  'purge-expired-programme-tombstones', '17 3 * * *',
  'select private.purge_expired_programme_tombstones()'
) where not exists (
  select 1 from cron.job where jobname = 'purge-expired-programme-tombstones'
);

commit;
