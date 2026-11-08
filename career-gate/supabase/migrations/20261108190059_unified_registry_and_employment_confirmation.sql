begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Priority no longer owns an operational queue. Recreate the stored column in
-- one transaction for PostgreSQL 16/17 compatibility; no client row UPDATE, fake
-- historical transition or guessed prior stage is written. DROP without CASCADE
-- fails safely if an unexpected external dependency was added after preflight.
alter table public.clients drop column operational_location;
alter table public.clients add column operational_location text generated always as (
  case when deleted_at is not null then 'deleted'
    when manager_review_id is not null then 'manager'
    when current_status='completed' then 'completed'
    when current_status='cancelled' then 'cancelled'
    else career_gate_private.workflow_location(current_status,pipeline_stage) end
) stored;
create index clients_operational_location_idx on public.clients(operational_location,updated_at desc,id) where deleted_at is null;
create index clients_urgent_location_idx on public.clients(operational_location,updated_at desc,id)
  where is_urgent and deleted_at is null and current_status not in ('completed','cancelled');
comment on column public.clients.operational_location is 'Exclusive workflow workspace; priority is an independent is_urgent flag.';

-- The combined Payment & Paperwork view is a display group, not a new route.
alter table public.staff_presence drop constraint staff_presence_workspace_section_check;
alter table public.staff_presence add constraint staff_presence_workspace_section_check check(workspace_section is null or
  (path='/staff/clients' and workspace_section in ('all','new_intake','account_setup','job_ready','appointments','payment_required','paperwork_pending','payment_paperwork','completed','urgent','worksite_change')));

-- Existing completed files are deliberately not backfilled as actually employed.
-- Their planned start_date remains unchanged and separately labelled by readers.
create table public.employment_confirmations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  actual_start_date date not null,
  site_code text not null check(length(trim(site_code))>0),
  site_name text not null check(length(trim(site_name))>0),
  site_address text,
  job_id text, job_title text,
  shift_code text, shift_name text, shift_days text, shift_hours text,
  worksite_change_id uuid references public.worksite_changes(id) on delete restrict,
  worksite_recorded_at timestamptz,
  confirmed_by uuid not null references public.staff(id) on delete restrict,
  confirmed_by_name text not null,
  confirmed_at timestamptz not null default now(),
  operation_id uuid not null,
  unique(confirmed_by,operation_id)
);
create index employment_confirmations_client_history_idx on public.employment_confirmations(client_id,confirmed_at desc,id desc);
create index employment_confirmations_actual_date_idx on public.employment_confirmations(actual_start_date desc,client_id);
create index employment_confirmations_worksite_idx on public.employment_confirmations(worksite_change_id) where worksite_change_id is not null;
alter table public.employment_confirmations enable row level security;
revoke all on public.employment_confirmations from public,anon,authenticated;
grant select,insert on public.employment_confirmations to authenticated;
create policy employment_confirmation_read on public.employment_confirmations for select to authenticated
  using(public.cg_can_access_client(client_id));
create policy employment_confirmation_insert on public.employment_confirmations for insert to authenticated
  with check(public.cg_can_access_client(client_id) and confirmed_by=public.cg_staff_id());

create function career_gate_private.guard_employment_confirmation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare c public.clients%rowtype; actor public.staff%rowtype; episode public.worksite_changes%rowtype; current_site text;
begin
  if tg_op<>'INSERT' then raise exception 'employment_confirmation_history_is_immutable' using errcode='42501'; end if;
  if current_setting('cg.employment_confirmation',true) is distinct from 'write' then
    raise exception 'employment_confirmation_requires_verified_command' using errcode='42501';
  end if;
  select * into actor from public.staff where id=public.cg_staff_id() and active;
  if not found or actor.role not in ('admin','manager','staff') then raise exception 'employment_confirmation_actor_required' using errcode='42501'; end if;
  if actor.role='staff' and actor.permission_mode<>'full' and not ('update_client'=any(actor.custom_permissions)) then
    raise exception 'employment_confirmation_permission_required' using errcode='42501';
  end if;
  select * into c from public.clients where id=new.client_id and deleted_at is null for update;
  if not found or not public.cg_can_access_client(new.client_id) then raise exception 'employment_client_not_accessible' using errcode='42501'; end if;
  if c.manager_review_id is not null then raise exception 'manager_review_pending' using errcode='P0001'; end if;
  if c.current_status='cancelled' then raise exception 'employment_cancelled_client' using errcode='23514'; end if;
  if not isfinite(new.actual_start_date) or new.actual_start_date<date '0001-01-01' or new.actual_start_date>(now() at time zone 'America/Detroit')::date then
    raise exception 'actual_start_in_future' using errcode='23514';
  end if;
  select * into episode from public.worksite_changes where client_id=new.client_id order by created_at desc,id desc limit 1;
  if found then
    if new.worksite_change_id is distinct from episode.id then
      raise exception 'employment_worksite_episode_mismatch' using errcode='23514';
    end if;
    -- Copy inside PostgreSQL so six-digit timestamp precision survives. Passing
    -- this through a JavaScript Date would silently truncate microseconds.
    new.worksite_recorded_at:=episode.recorded_at;
    if episode.status='confirmed' then
      if new.site_code is distinct from episode.final_site_code or new.site_name is distinct from episode.final_site_name or new.site_address is distinct from episode.final_site_address then
        raise exception 'employment_worksite_episode_mismatch' using errcode='23514';
      end if;
    else
      if c.operational_location='worksite_change' then raise exception 'employment_pending_worksite_is_active' using errcode='23514'; end if;
      select p.site_code into current_site from public.client_preferences p where p.client_id=c.id and p.rank='primary' order by p.preference_order,p.id limit 1;
      current_site:=coalesce(current_site,episode.current_site_code);
      if current_site is null or new.site_code is distinct from current_site then raise exception 'employment_current_site_required' using errcode='23514'; end if;
    end if;
  elsif new.worksite_change_id is not null or new.worksite_recorded_at is not null then raise exception 'employment_worksite_episode_mismatch' using errcode='23514';
  end if;
  new.confirmed_by:=actor.id; new.confirmed_by_name:=actor.display_name; new.confirmed_at:=now();
  return new;
end $$;
revoke all on function career_gate_private.guard_employment_confirmation() from public,anon;
create trigger employment_confirmation_guard before insert or update or delete on public.employment_confirmations
  for each row execute function career_gate_private.guard_employment_confirmation();

-- A first attestation cannot commit without the same original reaching the
-- final registry in that transaction. Subsequent explicit moves keep history.
create function career_gate_private.guard_employment_confirmation_commit() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.clients c where c.id=new.client_id and c.deleted_at is null
    and c.current_status='completed' and c.manager_review_id is null) then
    raise exception 'employment_confirmation_requires_final_move' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function career_gate_private.guard_employment_confirmation_commit() from public,anon;
create constraint trigger employment_confirmation_final_move after insert on public.employment_confirmations
  deferrable initially deferred for each row execute function career_gate_private.guard_employment_confirmation_commit();

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.employment_confirmations;
  end if;
end $$;

commit;
