-- Tamper-evident seal over public.activity_log.
--
-- activity_log is already append-only by trigger. Each sealed row's hash covers
-- the row's canonical content and the previous seal's hash, so altering,
-- removing or reordering a sealed row breaks every later link.
--
-- What this does and does not prove:
--   * A session that edits activity_log or audit_chain without recomputing the
--     chain is detected by cg_audit_verify.
--   * The hash is unkeyed and the formula is public. A session that owns these
--     tables can rewrite a row AND recompute every later seal, or remove the
--     newest rows together with their seals, and the chain alone still verifies.
--     That is detected only against a head recorded outside the database:
--     every seal and verify returns the head (seq, row_hash), the application
--     logs it, and cg_audit_verify(p_anchor_seq, p_anchor_hash) fails with
--     anchor_mismatch or truncated when the stored chain disagrees with it.
--
-- Additive: activity_log's columns, rows and existing triggers are unchanged.
-- New on activity_log: TRUNCATE is rejected, and rows inserted through the Data
-- API roles take created_at and staff_id from the database, not the caller.
-- Protection starts when a row is sealed: rows that existed before their first
-- seal carry no cryptographic evidence about their earlier history.
--
-- Open policy decision (not implemented): old_value/new_value can hold personal
-- data diffs, and a sealed row cannot later be redacted without breaking its
-- link. Any erasure procedure must be decided before rows are relied on.

begin;

create table public.audit_chain (
  seq bigint primary key check (seq > 0),
  log_id bigint not null unique references public.activity_log (id) on delete restrict,
  canon_version smallint not null default 1 check (canon_version = 1),
  prev_hash bytea not null check (length(prev_hash) = 32),
  row_hash bytea not null check (length(row_hash) = 32),
  sealed_at timestamptz not null default now()
);

-- Server-only, as jobs, rate_limits and the other server tables: RLS on, no
-- policies, not forced. The application reaches it as the table owner.
alter table public.audit_chain enable row level security;
revoke all on public.audit_chain from public, anon, authenticated, service_role;
grant select on public.audit_chain to service_role;

create trigger audit_chain_append_only before update or delete on public.audit_chain
  for each row execute function public.reject_mutation();
-- Row triggers do not fire on TRUNCATE, and TRUNCATE ... CASCADE on
-- activity_log would reach audit_chain through its foreign key.
create trigger audit_chain_no_truncate before truncate on public.audit_chain
  for each statement execute function public.reject_mutation();
create trigger activity_log_no_truncate before truncate on public.activity_log
  for each statement execute function public.reject_mutation();

-- authenticated may insert activity rows through the Data API (RLS checks only
-- the client). Such a row cannot claim another staff member or a past time.
-- Server code running as the owner is unaffected.
create function public.cg_activity_insert_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.created_at := now();
    new.staff_id := public.cg_staff_id();
  end if;
  return new;
end;
$$;

create trigger activity_log_insert_guard before insert on public.activity_log
  for each row execute function public.cg_activity_insert_guard();

-- Canonical form, version 1: the exact bytes a seal covers. The field list is
-- explicit, so a column added to activity_log later does not change the hash
-- of rows already sealed; covering it needs a new canon_version. Timestamps are
-- rendered in UTC so the session TimeZone cannot change them. old_value and
-- new_value are wrapped in a one-element array so SQL NULL ("null") and JSON
-- null ("[null]") produce different bytes.
create function public.cg_activity_canonical(l public.activity_log)
returns bytea
language sql
stable
set search_path = public, pg_temp
as $$
  select convert_to(jsonb_build_object(
    'id', l.id,
    'client_id', l.client_id,
    'action', l.action,
    'staff_id', l.staff_id,
    'entity_type', l.entity_type,
    'entity_id', l.entity_id,
    'old_value', case when l.old_value is null then null else jsonb_build_array(l.old_value) end,
    'new_value', case when l.new_value is null then null else jsonb_build_array(l.new_value) end,
    'trace_id', l.trace_id,
    'created_at', to_char(l.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  )::text, 'UTF8')
$$;

-- One link: sha256(prev_hash || canon_version as 2 bytes || canonical row).
create function public.cg_audit_link(p_prev bytea, p_version smallint, l public.activity_log)
returns bytea
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  if p_version = 1 then
    return sha256(p_prev || int2send(p_version) || public.cg_activity_canonical(l));
  end if;
  raise exception 'cg_audit_link: unknown canon_version %', p_version;
end;
$$;

-- Seals up to p_limit unsealed rows in id order. p_full = false looks only above
-- the highest sealed id (cheap, for frequent runs); p_full = true also finds
-- rows whose transaction committed after a higher id had been sealed, and
-- counts them as late. One sealer runs at a time: a second caller returns
-- busy at once instead of waiting.
create function public.cg_audit_seal(p_limit integer default 500, p_full boolean default false)
returns table (sealed integer, late integer, busy boolean, head_seq bigint, head_hash text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  last_seq bigint;
  last_hash bytea;
  max_sealed_id bigint;
  floor_id bigint;
  r public.activity_log%rowtype;
begin
  if p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'cg_audit_seal: p_limit must be between 1 and 10000';
  end if;
  -- Under REPEATABLE READ or SERIALIZABLE the snapshot predates the lock and
  -- the next seq could already be taken.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'cg_audit_seal: requires READ COMMITTED, not %', current_setting('transaction_isolation');
  end if;
  sealed := 0;
  late := 0;
  if not pg_try_advisory_xact_lock(hashtextextended('cg-audit-chain', 0)) then
    busy := true;
    return next;
    return;
  end if;
  busy := false;

  select c.seq, c.row_hash into last_seq, last_hash from public.audit_chain c order by c.seq desc limit 1;
  last_seq := coalesce(last_seq, 0);
  last_hash := coalesce(last_hash, decode(repeat('00', 32), 'hex'));
  max_sealed_id := coalesce((select max(c.log_id) from public.audit_chain c), 0);
  floor_id := case when p_full then 0 else max_sealed_id end;

  for r in
    select l.* from public.activity_log l
    where l.id > floor_id
      and not exists (select 1 from public.audit_chain c where c.log_id = l.id)
    order by l.id
    limit p_limit
  loop
    last_seq := last_seq + 1;
    insert into public.audit_chain (seq, log_id, canon_version, prev_hash, row_hash)
    values (last_seq, r.id, 1, last_hash, public.cg_audit_link(last_hash, 1::smallint, r))
    returning audit_chain.row_hash into last_hash;
    sealed := sealed + 1;
    if r.id < max_sealed_id then
      late := late + 1;
    end if;
  end loop;

  head_seq := nullif(last_seq, 0);
  head_hash := case when last_seq = 0 then null else encode(last_hash, 'hex') end;
  return next;
end;
$$;

-- Recomputes up to p_limit links from p_from_seq and reports the first that does
-- not hold; reason is null when every checked link verifies. last_seq below
-- max_seq means the check stopped at p_limit. With an anchor (a head recorded
-- outside the database) it also fails when the stored chain no longer has that
-- head: truncated (the chain ends before it) or anchor_mismatch (rewritten).
create function public.cg_audit_verify(
  p_from_seq bigint default 1,
  p_limit integer default 250000,
  p_anchor_seq bigint default null,
  p_anchor_hash text default null
)
returns table (checked bigint, last_seq bigint, max_seq bigint, first_invalid_seq bigint, reason text, unsealed bigint, head_hash text)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  expected_seq bigint := greatest(coalesce(p_from_seq, 1), 1);
  expected_prev bytea;
  anchored bytea;
  c record;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000000 then
    raise exception 'cg_audit_verify: p_limit must be between 1 and 1000000';
  end if;
  if (p_anchor_seq is null) <> (p_anchor_hash is null) then
    raise exception 'cg_audit_verify: an anchor needs both p_anchor_seq and p_anchor_hash';
  end if;
  if p_anchor_seq is not null and (p_anchor_seq < 1 or p_anchor_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'cg_audit_verify: invalid anchor';
  end if;

  checked := 0;
  max_seq := coalesce((select max(ac.seq) from public.audit_chain ac), 0);
  unsealed := (select count(*) from public.activity_log l where not exists (select 1 from public.audit_chain x where x.log_id = l.id));
  last_seq := expected_seq - 1;

  if p_anchor_seq is not null then
    if max_seq < p_anchor_seq then
      first_invalid_seq := max_seq + 1;
      reason := 'truncated';
      return next;
      return;
    end if;
    select ac.row_hash into anchored from public.audit_chain ac where ac.seq = p_anchor_seq;
    if anchored is null then
      first_invalid_seq := p_anchor_seq;
      reason := 'sequence_gap';
      return next;
      return;
    end if;
    if anchored <> decode(p_anchor_hash, 'hex') then
      first_invalid_seq := p_anchor_seq;
      reason := 'anchor_mismatch';
      return next;
      return;
    end if;
  end if;

  if expected_seq = 1 then
    expected_prev := decode(repeat('00', 32), 'hex');
  else
    select ac.row_hash into expected_prev from public.audit_chain ac where ac.seq = expected_seq - 1;
    if expected_prev is null then
      first_invalid_seq := expected_seq - 1;
      reason := 'missing_predecessor';
      return next;
      return;
    end if;
  end if;

  for c in
    select ac.seq, ac.canon_version, ac.prev_hash, ac.row_hash, l as log_row, l.id as log_id
    from public.audit_chain ac
    left join public.activity_log l on l.id = ac.log_id
    where ac.seq >= expected_seq
    order by ac.seq
    limit p_limit
  loop
    if c.seq <> expected_seq then
      reason := 'sequence_gap';
    elsif c.log_id is null then
      reason := 'missing_log_row';
    elsif c.prev_hash <> expected_prev then
      reason := 'broken_link';
    elsif c.row_hash <> public.cg_audit_link(c.prev_hash, c.canon_version, c.log_row) then
      reason := 'content_mismatch';
    end if;
    if reason is not null then
      first_invalid_seq := expected_seq;
      head_hash := case when last_seq = 0 then null else encode(expected_prev, 'hex') end;
      return next;
      return;
    end if;
    checked := checked + 1;
    expected_prev := c.row_hash;
    expected_seq := c.seq + 1;
    last_seq := c.seq;
  end loop;

  head_hash := case when last_seq = 0 then null else encode(expected_prev, 'hex') end;
  return next;
end;
$$;

revoke all on function public.cg_activity_insert_guard() from public, anon, authenticated, service_role;
revoke all on function public.cg_activity_canonical(public.activity_log) from public, anon, authenticated;
revoke all on function public.cg_audit_link(bytea, smallint, public.activity_log) from public, anon, authenticated;
revoke all on function public.cg_audit_seal(integer, boolean) from public, anon, authenticated;
revoke all on function public.cg_audit_verify(bigint, integer, bigint, text) from public, anon, authenticated;
grant execute on function public.cg_activity_canonical(public.activity_log) to service_role;
grant execute on function public.cg_audit_link(bytea, smallint, public.activity_log) to service_role;
grant execute on function public.cg_audit_seal(integer, boolean) to service_role;
grant execute on function public.cg_audit_verify(bigint, integer, bigint, text) to service_role;

commit;
