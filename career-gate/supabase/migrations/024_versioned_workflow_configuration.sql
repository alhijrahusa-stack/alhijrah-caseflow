-- Versioned workflow configuration.
-- workflow_versions is configuration history/authority; the existing runtime
-- tables remain the single active projection consumed by triggers and queries.

begin;

create table if not exists public.workflow_versions (
  id uuid primary key default gen_random_uuid(),
  version_no integer not null unique check (version_no > 0),
  label text not null check (length(trim(label)) > 0),
  status text not null default 'draft' check (status in ('draft','published','retired')),
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  published_by uuid references public.staff(id),
  published_at timestamptz,
  note text,
  check (status <> 'published' or published_at is not null)
);
create unique index if not exists workflow_versions_one_published_idx
  on public.workflow_versions((status)) where status='published';

create table if not exists public.workflow_version_status_rules (
  version_id uuid not null references public.workflow_versions(id) on delete cascade,
  status text not null,
  label_en text not null,
  default_next_action text not null check (length(trim(default_next_action)) > 0),
  sequence smallint not null,
  terminal boolean not null default false,
  active boolean not null default true,
  primary key(version_id,status),
  unique(version_id,sequence)
);

create table if not exists public.workflow_version_transitions (
  version_id uuid not null references public.workflow_versions(id) on delete cascade,
  from_status text not null,
  to_status text not null,
  primary key(version_id,from_status,to_status),
  check (from_status <> to_status)
);

create table if not exists public.workflow_version_entry_states (
  version_id uuid not null references public.workflow_versions(id) on delete cascade,
  status text not null,
  primary key(version_id,status)
);

-- Capture the verified active runtime as version 1 exactly once.
do $$
declare
  v_id uuid;
begin
  if not exists(select 1 from public.workflow_versions) then
    insert into public.workflow_versions(version_no,label,status,published_at,note)
    values(1,'Baseline 2026','published',now(),'Backfilled from verified runtime workflow')
    returning id into v_id;

    insert into public.workflow_version_status_rules(version_id,status,label_en,default_next_action,sequence,terminal,active)
      select v_id,status,label_en,default_next_action,sequence,terminal,active
      from public.workflow_status_rules;
    insert into public.workflow_version_transitions(version_id,from_status,to_status)
      select v_id,from_status,to_status from public.status_transitions;
    insert into public.workflow_version_entry_states(version_id,status)
      select v_id,status from public.status_entry_states;
  end if;
end
$$;

create or replace function public.clone_workflow_version(p_label text,p_note text default null)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_current uuid;
  v_new uuid;
  v_no integer;
  v_actor uuid;
begin
  v_actor := public.cg_staff_id();
  if public.cg_staff_role() <> 'admin' or v_actor is null then
    raise exception 'admin required' using errcode='42501';
  end if;
  if nullif(trim(p_label),'') is null then raise exception 'label required'; end if;

  select id into v_current from public.workflow_versions where status='published' order by version_no desc limit 1;
  if v_current is null then raise exception 'published workflow missing'; end if;
  select coalesce(max(version_no),0)+1 into v_no from public.workflow_versions for update;

  insert into public.workflow_versions(version_no,label,status,created_by,note)
  values(v_no,trim(p_label),'draft',v_actor,p_note) returning id into v_new;

  insert into public.workflow_version_status_rules(version_id,status,label_en,default_next_action,sequence,terminal,active)
    select v_new,status,label_en,default_next_action,sequence,terminal,active
    from public.workflow_version_status_rules where version_id=v_current;
  insert into public.workflow_version_transitions(version_id,from_status,to_status)
    select v_new,from_status,to_status from public.workflow_version_transitions where version_id=v_current;
  insert into public.workflow_version_entry_states(version_id,status)
    select v_new,status from public.workflow_version_entry_states where version_id=v_current;
  return v_new;
end;
$$;

create or replace function public.validate_workflow_version(p_version uuid)
returns jsonb
language plpgsql
security invoker
set search_path=public,pg_temp
as $$
declare
  v_missing_transition_states integer;
  v_missing_entries integer;
  v_active_rules integer;
  v_terminal integer;
begin
  if not exists(select 1 from public.workflow_versions where id=p_version) then
    raise exception 'workflow version not found';
  end if;
  select count(*) into v_active_rules from public.workflow_version_status_rules where version_id=p_version and active;
  select count(*) into v_terminal from public.workflow_version_status_rules where version_id=p_version and active and terminal;
  select count(*) into v_missing_entries
    from public.workflow_version_entry_states e
    left join public.workflow_version_status_rules r on r.version_id=e.version_id and r.status=e.status and r.active
    where e.version_id=p_version and r.status is null;
  select count(*) into v_missing_transition_states
    from (
      select from_status status from public.workflow_version_transitions where version_id=p_version
      union
      select to_status from public.workflow_version_transitions where version_id=p_version
    ) s
    left join public.workflow_version_status_rules r on r.version_id=p_version and r.status=s.status and r.active
    where r.status is null;
  return jsonb_build_object(
    'valid', v_active_rules > 0 and v_terminal > 0 and v_missing_entries=0 and v_missing_transition_states=0
             and exists(select 1 from public.workflow_version_entry_states where version_id=p_version),
    'active_rules',v_active_rules,
    'terminal_states',v_terminal,
    'missing_entry_rules',v_missing_entries,
    'missing_transition_rules',v_missing_transition_states,
    'entry_states',(select count(*) from public.workflow_version_entry_states where version_id=p_version),
    'transitions',(select count(*) from public.workflow_version_transitions where version_id=p_version)
  );
end;
$$;

create or replace function public.publish_workflow_version(p_version uuid)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor uuid;
  v_validation jsonb;
  v_no integer;
begin
  v_actor:=public.cg_staff_id();
  if public.cg_staff_role()<>'admin' or v_actor is null then
    raise exception 'admin required' using errcode='42501';
  end if;
  select version_no into v_no from public.workflow_versions where id=p_version and status='draft' for update;
  if v_no is null then raise exception 'draft workflow version not found'; end if;
  v_validation:=public.validate_workflow_version(p_version);
  if not coalesce((v_validation->>'valid')::boolean,false) then
    raise exception 'workflow validation failed: %',v_validation;
  end if;

  -- Retire previous configuration, then atomically replace runtime projection.
  update public.workflow_versions set status='retired' where status='published';

  delete from public.status_transitions;
  insert into public.status_transitions(from_status,to_status)
    select from_status,to_status from public.workflow_version_transitions where version_id=p_version;

  delete from public.status_entry_states;
  insert into public.status_entry_states(status)
    select status from public.workflow_version_entry_states where version_id=p_version;

  delete from public.workflow_status_rules;
  insert into public.workflow_status_rules(status,label_en,default_next_action,sequence,terminal,active,updated_at)
    select status,label_en,default_next_action,sequence,terminal,active,now()
      from public.workflow_version_status_rules where version_id=p_version;

  update public.workflow_versions
     set status='published',published_by=v_actor,published_at=now()
   where id=p_version;

  return v_validation || jsonb_build_object('published_version',v_no,'published_at',now());
end;
$$;

revoke execute on function public.clone_workflow_version(text,text) from public,anon;
revoke execute on function public.publish_workflow_version(uuid) from public,anon;
revoke execute on function public.validate_workflow_version(uuid) from public,anon;
grant execute on function public.clone_workflow_version(text,text) to authenticated,service_role;
grant execute on function public.publish_workflow_version(uuid) to authenticated,service_role;
grant execute on function public.validate_workflow_version(uuid) to authenticated,service_role;

alter table public.workflow_versions enable row level security;
alter table public.workflow_version_status_rules enable row level security;
alter table public.workflow_version_transitions enable row level security;
alter table public.workflow_version_entry_states enable row level security;

create policy workflow_versions_staff_read on public.workflow_versions for select to authenticated using(public.cg_staff_id() is not null);
create policy workflow_versions_admin_write on public.workflow_versions for all to authenticated using(public.cg_staff_role()='admin') with check(public.cg_staff_role()='admin');
create policy workflow_version_rules_staff_read on public.workflow_version_status_rules for select to authenticated using(public.cg_staff_id() is not null);
create policy workflow_version_rules_admin_write on public.workflow_version_status_rules for all to authenticated using(public.cg_staff_role()='admin') with check(public.cg_staff_role()='admin');
create policy workflow_version_transitions_staff_read on public.workflow_version_transitions for select to authenticated using(public.cg_staff_id() is not null);
create policy workflow_version_transitions_admin_write on public.workflow_version_transitions for all to authenticated using(public.cg_staff_role()='admin') with check(public.cg_staff_role()='admin');
create policy workflow_version_entries_staff_read on public.workflow_version_entry_states for select to authenticated using(public.cg_staff_id() is not null);
create policy workflow_version_entries_admin_write on public.workflow_version_entry_states for all to authenticated using(public.cg_staff_role()='admin') with check(public.cg_staff_role()='admin');

grant select,insert,update,delete on public.workflow_versions to authenticated;
grant select,insert,update,delete on public.workflow_version_status_rules to authenticated;
grant select,insert,update,delete on public.workflow_version_transitions to authenticated;
grant select,insert,update,delete on public.workflow_version_entry_states to authenticated;

insert into public.permission_rules(role,resource,action,scope) values
 ('admin','workflow','configure_workflow','ALL'),('manager','workflow','configure_workflow','NONE'),('staff','workflow','configure_workflow','NONE')
on conflict(role,resource,action) do update set scope=excluded.scope,updated_at=now();

commit;
