do $$ begin
  if not exists (
    select 1 from pg_constraint where conname='clients_pipeline_stage_fk' and conrelid='public.clients'::regclass
  ) then
    alter table public.clients add constraint clients_pipeline_stage_fk
      foreign key (pipeline_stage) references public.pipeline_stages(key);
  end if;
end $$;

create or replace function public.guard_client_identity_duplicate()
returns trigger
language plpgsql
set search_path=public
as $$
declare r record; ek text; pk text;
begin
  ek:=nullif(lower(trim(coalesce(new.email,''))),'');
  pk:=nullif(regexp_replace(coalesce(new.phone,''),'\D','','g'),'');
  if ek is not null then
    perform pg_advisory_xact_lock(hashtextextended('cg-email:'||ek,0));
    select c.ref,c.pipeline_stage,s.display_name owner into r
    from public.clients c left join public.staff s on s.id=c.assigned_staff
    where c.deleted_at is null and c.id is distinct from new.id
      and lower(trim(coalesce(c.email,'')))=ek
    order by c.created_at limit 1;
    if found then
      raise exception 'duplicate_client_identity|email|%|%|%',r.ref,r.pipeline_stage,coalesce(r.owner,'Unassigned') using errcode='P0001';
    end if;
  end if;
  if pk is not null and length(pk)>=7 then
    perform pg_advisory_xact_lock(hashtextextended('cg-phone:'||pk,0));
    select c.ref,c.pipeline_stage,s.display_name owner into r
    from public.clients c left join public.staff s on s.id=c.assigned_staff
    where c.deleted_at is null and c.id is distinct from new.id
      and regexp_replace(coalesce(c.phone,''),'\D','','g')=pk
    order by c.created_at limit 1;
    if found then
      raise exception 'duplicate_client_identity|phone|%|%|%',r.ref,r.pipeline_stage,coalesce(r.owner,'Unassigned') using errcode='P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_identity_duplicate_guard on public.clients;
create trigger clients_identity_duplicate_guard
before insert or update of email,phone on public.clients
for each row execute function public.guard_client_identity_duplicate();

create table if not exists public.ownership_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  requested_by uuid not null references public.staff(id),
  current_owner uuid references public.staff(id),
  requested_owner uuid references public.staff(id),
  reason text,
  status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
  reviewed_by uuid references public.staff(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists ownership_transfer_one_pending
  on public.ownership_transfer_requests(client_id) where status='pending';

create table if not exists public.assignment_settings (
  singleton boolean primary key default true check(singleton),
  round_robin_enabled boolean not null default false,
  cursor bigint not null default 0 check(cursor>=0),
  updated_by uuid references public.staff(id),
  updated_at timestamptz not null default now()
);
insert into public.assignment_settings(singleton) values(true) on conflict do nothing;

create or replace function public.assign_client_round_robin()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare enabled boolean; n integer; cur bigint; picked uuid;
begin
  if new.assigned_staff is not null or new.source<>'public_intake' then return new; end if;
  select round_robin_enabled,cursor into enabled,cur
  from public.assignment_settings where singleton=true for update;
  if not coalesce(enabled,false) then return new; end if;
  select count(*)::int into n from public.staff
  where active and eligible_for_round_robin and staff_code is not null;
  if n=0 then return new; end if;
  select id into picked from public.staff
  where active and eligible_for_round_robin and staff_code is not null
  order by staff_code offset (cur%n) limit 1;
  if picked is not null then
    new.assigned_staff:=picked;
    update public.assignment_settings set cursor=cur+1,updated_at=now() where singleton=true;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_round_robin_assignment on public.clients;
create trigger clients_round_robin_assignment
before insert on public.clients
for each row execute function public.assign_client_round_robin();

alter table public.activity_log drop constraint if exists activity_log_action_check;
alter table public.activity_log add constraint activity_log_action_check check(action in (
'client_created','client_updated','client_deleted','preference_added','preference_removed',
'status_changed','status_overridden','next_step_changed','staff_assigned','pipeline_stage_changed',
'transfer_requested','payment_updated','bulk_staff_assigned','round_robin_setting_changed',
'document_uploaded','document_processing_started','document_processed','document_verified','document_rejected',
'document_reupload_requested','document_opened','appointment_created','appointment_updated','appointment_rescheduled',
'appointment_completed','note_added','task_added','task_updated','task_completed','contact_logged','followup_created',
'followup_completed','assessment_updated','post_hire_updated','agent_alert_created','agent_run','notification_queued',
'notification_sent','notification_failed','notification_not_configured','status_otp_requested','status_otp_verified'
));

alter table public.pipeline_stages enable row level security;
alter table public.client_accounts enable row level security;
alter table public.ownership_transfer_requests enable row level security;
alter table public.assignment_settings enable row level security;

grant select on public.pipeline_stages to authenticated;
grant select,insert,update on public.client_accounts to authenticated;
grant select,insert,update on public.ownership_transfer_requests to authenticated;
grant select,update on public.assignment_settings to authenticated;

create policy pipeline_stages_read on public.pipeline_stages for select to authenticated
using(public.cg_staff_id() is not null);
create policy accounts_read on public.client_accounts for select to authenticated
using(public.cg_can_access_client(client_id));
create policy accounts_insert on public.client_accounts for insert to authenticated
with check(public.cg_staff_role() in ('admin','manager'));
create policy accounts_update on public.client_accounts for update to authenticated
using(public.cg_staff_role() in ('admin','manager')) with check(public.cg_staff_role() in ('admin','manager'));
create policy transfer_read on public.ownership_transfer_requests for select to authenticated
using(public.cg_staff_role() in ('admin','manager') or requested_by=public.cg_staff_id());
create policy transfer_insert on public.ownership_transfer_requests for insert to authenticated
with check(requested_by=public.cg_staff_id());
create policy transfer_update on public.ownership_transfer_requests for update to authenticated
using(public.cg_staff_role() in ('admin','manager')) with check(public.cg_staff_role() in ('admin','manager'));
create policy assignment_settings_read on public.assignment_settings for select to authenticated
using(public.cg_staff_id() is not null);
create policy assignment_settings_update on public.assignment_settings for update to authenticated
using(public.cg_staff_role()='admin') with check(public.cg_staff_role()='admin');
