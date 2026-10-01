-- Isolate the preserved legacy employment-marketplace job domain from the
-- Career Gate background job queue. The old `jobs` table was renamed to
-- `legacy_jobs_20260927`, but several legacy functions retained textual
-- references to `jobs`, which now names the Career Gate queue.
--
-- This migration deliberately preserves all legacy rows, IDs, triggers and
-- history. It only repairs those known stale function references. On a fresh
-- Career Gate database, where the legacy table is absent, it is a no-op.

begin;

do $$
declare
  r record;
  original text;
  repaired text;
begin
  if to_regclass('public.legacy_jobs_20260927') is null then
    return;
  end if;

  for r in
    select p.oid, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname = any(array[
         'expire_stale_jobs',
         'escalate_stale_applications',
         'get_candidate_contact',
         'match_candidates',
         'match_jobs',
         'sync_applications_count',
         'unlock_candidate_contact'
       ])
  loop
    original := pg_get_functiondef(r.oid);
    repaired := original;

    -- Only rewrite SQL relation references, never function names or comments.
    repaired := replace(repaired, ' from jobs ', ' from public.legacy_jobs_20260927 ');
    repaired := replace(repaired, ' join jobs ', ' join public.legacy_jobs_20260927 ');
    repaired := replace(repaired, ' update jobs ', ' update public.legacy_jobs_20260927 ');
    repaired := replace(repaired, E'\n    from jobs ', E'\n    from public.legacy_jobs_20260927 ');
    repaired := replace(repaired, E'\n    join jobs ', E'\n    join public.legacy_jobs_20260927 ');
    repaired := replace(repaired, E'\n  update jobs ', E'\n  update public.legacy_jobs_20260927 ');

    if repaired = original then
      raise exception 'legacy function % did not contain an expected jobs relation reference', r.proname;
    end if;

    execute repaired;
  end loop;
end
$$;

-- Server-maintenance and trigger-only legacy functions are not public RPCs.
do $$
begin
  if to_regprocedure('public.expire_stale_jobs()') is not null then
    revoke execute on function public.expire_stale_jobs() from public, anon, authenticated;
    grant execute on function public.expire_stale_jobs() to service_role;
  end if;
  if to_regprocedure('public.escalate_stale_applications()') is not null then
    revoke execute on function public.escalate_stale_applications() from public, anon, authenticated;
    grant execute on function public.escalate_stale_applications() to service_role;
  end if;
  if to_regprocedure('public.sync_applications_count()') is not null then
    revoke execute on function public.sync_applications_count() from public, anon, authenticated;
    grant execute on function public.sync_applications_count() to service_role;
  end if;

  -- PII-bearing / employer matching functions require a signed-in identity.
  if to_regprocedure('public.get_candidate_contact(uuid)') is not null then
    revoke execute on function public.get_candidate_contact(uuid) from public, anon;
    grant execute on function public.get_candidate_contact(uuid) to authenticated, service_role;
  end if;
  if to_regprocedure('public.unlock_candidate_contact(uuid)') is not null then
    revoke execute on function public.unlock_candidate_contact(uuid) from public, anon;
    grant execute on function public.unlock_candidate_contact(uuid) to authenticated, service_role;
  end if;
  if to_regprocedure('public.match_candidates(uuid,integer)') is not null then
    revoke execute on function public.match_candidates(uuid,integer) from public, anon;
    grant execute on function public.match_candidates(uuid,integer) to authenticated, service_role;
  end if;
  if to_regprocedure('public.match_jobs(uuid,integer)') is not null then
    revoke execute on function public.match_jobs(uuid,integer) from public, anon;
    grant execute on function public.match_jobs(uuid,integer) to authenticated, service_role;
  end if;
end
$$;

commit;
