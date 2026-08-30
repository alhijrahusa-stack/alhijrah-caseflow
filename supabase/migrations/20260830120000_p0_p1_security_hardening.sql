begin;

-- Backend-only shared throttle. It stores only an HMAC digest, never an email
-- address or raw IP. service_role remains the sole Data API caller.
create table if not exists public.security_login_throttles (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  attempt_count integer not null check (attempt_count > 0),
  window_started_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  check (expires_at > window_started_at)
);

alter table public.security_login_throttles enable row level security;
alter table public.security_login_throttles force row level security;

revoke all on table public.security_login_throttles from public, anon, authenticated;
grant select, insert, update, delete on table public.security_login_throttles to service_role;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'security_login_throttles'
      and policyname = 'security_login_throttles_server_only'
  ) then
    create policy security_login_throttles_server_only
      on public.security_login_throttles
      as restrictive
      for all
      to anon, authenticated
      using (false)
      with check (false);
  end if;
end;
$$;

create or replace function public.consume_login_attempt(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_row public.security_login_throttles%rowtype;
begin
  if p_key_hash !~ '^[0-9a-f]{64}$'
     or p_limit < 1 or p_limit > 100
     or p_window_seconds < 60 or p_window_seconds > 86400 then
    raise exception 'invalid login throttle input' using errcode = '22023';
  end if;

  insert into public.security_login_throttles(
    key_hash, attempt_count, window_started_at, expires_at, updated_at
  ) values (
    p_key_hash, 1, v_now, v_now + make_interval(secs => p_window_seconds), v_now
  )
  on conflict (key_hash) do update
  set attempt_count = case
        when security_login_throttles.expires_at <= v_now then 1
        else security_login_throttles.attempt_count + 1
      end,
      window_started_at = case
        when security_login_throttles.expires_at <= v_now then v_now
        else security_login_throttles.window_started_at
      end,
      expires_at = case
        when security_login_throttles.expires_at <= v_now
          then v_now + make_interval(secs => p_window_seconds)
        else security_login_throttles.expires_at
      end,
      updated_at = v_now
  returning * into v_row;

  delete from public.security_login_throttles
  where key_hash in (
    select key_hash from public.security_login_throttles
    where expires_at < v_now - interval '1 hour'
    order by expires_at
    limit 100
  );

  return query select
    v_row.attempt_count <= p_limit,
    greatest(0, ceil(extract(epoch from (v_row.expires_at - v_now))))::integer;
end;
$$;

create or replace function public.clear_login_attempt(p_key_hash text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid login throttle input' using errcode = '22023';
  end if;
  delete from public.security_login_throttles where key_hash = p_key_hash;
  return true;
end;
$$;

revoke all on function public.consume_login_attempt(text, integer, integer) from public, anon, authenticated;
revoke all on function public.clear_login_attempt(text) from public, anon, authenticated;
grant execute on function public.consume_login_attempt(text, integer, integer) to service_role;
grant execute on function public.clear_login_attempt(text) to service_role;

comment on table public.security_login_throttles is
  'Backend-only bounded login throttle keyed by an application HMAC digest; never client-accessible.';

commit;
