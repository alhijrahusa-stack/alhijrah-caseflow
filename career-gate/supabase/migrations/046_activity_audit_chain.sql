-- Tamper-evident seal over public.activity_log.
--
-- activity_log is already append-only by trigger. That trigger stops ordinary
-- writes; it does not stop a privileged session that disables it. This chain
-- makes such a change detectable: each sealed row's hash covers the row's
-- canonical content and the previous seal's hash, so altering, removing or
-- reordering a sealed row breaks every later link.
--
-- Additive only. activity_log, its rows and its trigger are not modified; the
-- seal lives in its own append-only table. Protection starts when a row is
-- sealed: rows that existed before their first seal carry no cryptographic
-- evidence about their earlier history.

create table if not exists public.audit_chain (
  seq bigint primary key check (seq > 0),
  log_id bigint not null unique references public.activity_log (id) on delete restrict,
  prev_hash bytea not null check (length(prev_hash) = 32),
  row_hash bytea not null check (length(row_hash) = 32),
  sealed_at timestamptz not null default now()
);

alter table public.audit_chain enable row level security;
alter table public.audit_chain force row level security;
revoke all on public.audit_chain from public, anon, authenticated;
grant select, insert on public.audit_chain to service_role;

drop trigger if exists audit_chain_append_only on public.audit_chain;
create trigger audit_chain_append_only before update or delete on public.audit_chain
  for each row execute function public.reject_mutation();

-- The exact bytes a seal covers. The field list is explicit so a column added
-- to activity_log later cannot silently change the hash of rows already sealed.
-- Timestamps are rendered in UTC so the session TimeZone cannot change them.
create or replace function public.cg_activity_canonical(l public.activity_log)
returns bytea
language sql
stable
set search_path = public
as $$
  select convert_to(jsonb_build_object(
    'id', l.id,
    'client_id', l.client_id,
    'action', l.action,
    'staff_id', l.staff_id,
    'entity_type', l.entity_type,
    'entity_id', l.entity_id,
    'old_value', l.old_value,
    'new_value', l.new_value,
    'trace_id', l.trace_id,
    'created_at', to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )::text, 'UTF8')
$$;

-- Seals up to p_limit unsealed rows in id order and returns how many it sealed.
-- p_full = false looks only above the highest sealed id (cheap, for frequent
-- runs); p_full = true also finds rows whose transaction committed after a
-- higher id had been sealed. One sealer runs at a time.
create or replace function public.cg_audit_seal(p_limit integer default 500, p_full boolean default false)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  last_seq bigint;
  last_hash bytea;
  floor_id bigint;
  r public.activity_log%rowtype;
  sealed integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'cg_audit_seal: p_limit must be between 1 and 10000';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cg-audit-chain', 0));

  select c.seq, c.row_hash into last_seq, last_hash from public.audit_chain c order by c.seq desc limit 1;
  last_seq := coalesce(last_seq, 0);
  last_hash := coalesce(last_hash, decode(repeat('00', 32), 'hex'));
  floor_id := case when p_full then 0 else coalesce((select max(c.log_id) from public.audit_chain c), 0) end;

  for r in
    select l.* from public.activity_log l
    where l.id > floor_id
      and not exists (select 1 from public.audit_chain c where c.log_id = l.id)
    order by l.id
    limit p_limit
  loop
    last_seq := last_seq + 1;
    insert into public.audit_chain (seq, log_id, prev_hash, row_hash)
    values (last_seq, r.id, last_hash, sha256(last_hash || public.cg_activity_canonical(r)))
    returning row_hash into last_hash;
    sealed := sealed + 1;
  end loop;
  return sealed;
end;
$$;

-- Recomputes the chain from p_from_seq and reports the first link that does not
-- hold. reason is null when every checked link verifies.
create or replace function public.cg_audit_verify(p_from_seq bigint default 1, p_limit integer default 1000000)
returns table (checked bigint, last_seq bigint, first_invalid_seq bigint, reason text, unsealed bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  expected_seq bigint := greatest(coalesce(p_from_seq, 1), 1);
  expected_prev bytea;
  c record;
  n bigint := 0;
begin
  if expected_seq = 1 then
    expected_prev := decode(repeat('00', 32), 'hex');
  else
    select ac.row_hash into expected_prev from public.audit_chain ac where ac.seq = expected_seq - 1;
    if expected_prev is null then
      return query select 0::bigint, null::bigint, expected_seq - 1, 'missing_predecessor'::text,
        (select count(*) from public.activity_log l where not exists (select 1 from public.audit_chain x where x.log_id = l.id));
      return;
    end if;
  end if;

  for c in
    select ac.seq, ac.prev_hash, ac.row_hash, l as log_row, l.id as log_id
    from public.audit_chain ac
    left join public.activity_log l on l.id = ac.log_id
    where ac.seq >= expected_seq
    order by ac.seq
    limit p_limit
  loop
    if c.seq <> expected_seq then
      return query select n, expected_seq - 1, expected_seq, 'sequence_gap'::text,
        (select count(*) from public.activity_log l where not exists (select 1 from public.audit_chain x where x.log_id = l.id));
      return;
    end if;
    if c.log_id is null then
      return query select n, c.seq - 1, c.seq, 'missing_log_row'::text,
        (select count(*) from public.activity_log l where not exists (select 1 from public.audit_chain x where x.log_id = l.id));
      return;
    end if;
    if c.prev_hash <> expected_prev then
      return query select n, c.seq - 1, c.seq, 'broken_link'::text,
        (select count(*) from public.activity_log l where not exists (select 1 from public.audit_chain x where x.log_id = l.id));
      return;
    end if;
    if c.row_hash <> sha256(c.prev_hash || public.cg_activity_canonical(c.log_row)) then
      return query select n, c.seq - 1, c.seq, 'content_mismatch'::text,
        (select count(*) from public.activity_log l where not exists (select 1 from public.audit_chain x where x.log_id = l.id));
      return;
    end if;
    n := n + 1;
    expected_prev := c.row_hash;
    expected_seq := c.seq + 1;
  end loop;

  return query select n, expected_seq - 1, null::bigint, null::text,
    (select count(*) from public.activity_log l where not exists (select 1 from public.audit_chain x where x.log_id = l.id));
end;
$$;

revoke all on function public.cg_activity_canonical(public.activity_log) from public, anon, authenticated;
revoke all on function public.cg_audit_seal(integer, boolean) from public, anon, authenticated;
revoke all on function public.cg_audit_verify(bigint, integer) from public, anon, authenticated;
grant execute on function public.cg_activity_canonical(public.activity_log) to service_role;
grant execute on function public.cg_audit_seal(integer, boolean) to service_role;
grant execute on function public.cg_audit_verify(bigint, integer) to service_role;
