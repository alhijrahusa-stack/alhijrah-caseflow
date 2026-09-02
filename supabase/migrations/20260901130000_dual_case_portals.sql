begin;

insert into public.roles(code,name) values
  ('employer_portal','Employer Portal'),
  ('beneficiary_portal','Beneficiary Portal')
on conflict(code) do update set name=excluded.name;

insert into public.role_permissions(role_code,permission_code) values
  ('employer_portal','portal.view'),
  ('employer_portal','portal.documents'),
  ('employer_portal','portal.messages'),
  ('beneficiary_portal','portal.view'),
  ('beneficiary_portal','portal.intake'),
  ('beneficiary_portal','portal.documents'),
  ('beneficiary_portal','portal.messages')
on conflict do nothing;

create table if not exists public.portal_case_access(
  case_id uuid not null references public.cases(id) on delete restrict,
  auth_user_id uuid not null references public.app_users(auth_user_id) on delete restrict,
  portal_type text not null check(portal_type in('employer','beneficiary')),
  person_id uuid references public.people(id) on delete restrict,
  status text not null default 'active' check(status in('active','revoked')),
  granted_by uuid not null references public.app_users(auth_user_id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key(case_id,auth_user_id),
  check((status='active' and revoked_at is null) or status='revoked'),
  check(portal_type<>'beneficiary' or person_id is not null)
);
create index if not exists portal_case_access_user_active_idx
  on public.portal_case_access(auth_user_id,case_id) where status='active';

create or replace function public.caseflow_actor_portal()
returns boolean language sql stable security definer
set search_path=public,pg_temp as $$
  select public.caseflow_actor_active()
    and exists(select 1 from public.user_roles r where r.auth_user_id=public.caseflow_actor_id())
    and not exists(select 1 from public.user_roles r where r.auth_user_id=public.caseflow_actor_id()
      and r.role_code not in ('client_owner','client_collaborator','employer_portal','beneficiary_portal'))
$$;

create or replace function public.protect_portal_case_access()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='UPDATE' and (
    old.case_id is distinct from new.case_id or
    old.auth_user_id is distinct from new.auth_user_id or
    old.portal_type is distinct from new.portal_type or
    old.person_id is distinct from new.person_id or
    old.granted_by is distinct from new.granted_by or
    old.granted_at is distinct from new.granted_at
  ) then raise exception 'Portal case ownership is immutable'; end if;
  if not exists(select 1 from public.app_users u where u.auth_user_id=new.auth_user_id and u.status='active')
  then raise exception 'Portal user must be active'; end if;
  if new.portal_type='beneficiary' and not exists(
    select 1 from public.case_people cp where cp.case_id=new.case_id and cp.person_id=new.person_id
      and cp.case_role in('beneficiary','principal_applicant','derivative_beneficiary','spouse','child'))
  then raise exception 'Beneficiary portal person must participate in the case'; end if;
  if not exists(
    select 1 from public.user_roles ur where ur.auth_user_id=new.auth_user_id
      and ur.role_code=case when new.portal_type='employer' then 'employer_portal' else 'beneficiary_portal' end)
  then raise exception 'Portal user role does not match portal type'; end if;
  return new;
end;
$$;

do $$ begin
  if not exists(select 1 from pg_trigger where tgrelid='public.portal_case_access'::regclass
    and tgname='portal_case_access_protect' and not tgisinternal) then
    create trigger portal_case_access_protect before insert or update on public.portal_case_access
      for each row execute function public.protect_portal_case_access();
  end if;
end $$;

alter table public.portal_case_access enable row level security;
alter table public.portal_case_access force row level security;
revoke all on public.portal_case_access from public,anon,authenticated;
grant select,insert,update on public.portal_case_access to authenticated;
grant all on public.portal_case_access to service_role;

create or replace function public.caseflow_can_case(case_uuid uuid, requested text)
returns boolean language plpgsql stable security definer
set search_path=public,pg_temp as $$
declare c public.cases%rowtype; actor uuid:=public.caseflow_actor_id(); category_key text; selected_scope text;
begin
  if not public.caseflow_actor_active() or case_uuid is null then return false; end if;
  if public.caseflow_actor_owner() then return exists(select 1 from public.cases where id=case_uuid); end if;
  select * into c from public.cases where id=case_uuid and archived_at is null;
  if not found then return false; end if;
  select category into category_key from public.service_catalog where code=c.service_code;
  if public.caseflow_subject_grant('case',c.id,null,requested,'restrict')
    or public.caseflow_subject_grant('client',c.client_id,null,requested,'restrict')
    or public.caseflow_subject_grant('service',null,c.service_code,requested,'restrict')
    or public.caseflow_subject_grant('category',null,category_key,requested,'restrict') then return false; end if;
  if not public.caseflow_has_permission(requested) then return false; end if;
  if public.caseflow_subject_grant('case',c.id,null,requested,'grant')
    or public.caseflow_subject_grant('client',c.client_id,null,requested,'grant')
    or public.caseflow_subject_grant('service',null,c.service_code,requested,'grant')
    or public.caseflow_subject_grant('category',null,category_key,requested,'grant') then return true; end if;
  selected_scope:=public.caseflow_scope(split_part(requested,'.',1));
  if selected_scope='global' then return true; end if;
  if selected_scope='team' then return c.team_id is not null and exists(
    select 1 from public.team_members tm where tm.team_id=c.team_id and tm.user_id=actor); end if;
  if selected_scope='assigned' then return exists(select 1 from public.case_assignments a
    where a.case_id=c.id and a.auth_user_id=actor and a.active); end if;
  if selected_scope='client_self' then return
    exists(select 1 from public.client_access a where a.client_id=c.client_id and a.auth_user_id=actor and a.status='active')
    or exists(select 1 from public.portal_case_access p where p.case_id=c.id and p.auth_user_id=actor and p.status='active');
  end if;
  return false;
end;
$$;

create policy portal_case_access_read on public.portal_case_access for select to authenticated using(
  public.caseflow_actor_active() and (
    auth_user_id=public.caseflow_actor_id() or public.caseflow_actor_owner()
    or public.caseflow_can_case(case_id,'cases.manage')));
create policy portal_case_access_insert on public.portal_case_access for insert to authenticated with check(
  public.caseflow_can_case(case_id,'cases.manage')
  and granted_by=public.caseflow_actor_id());
create policy portal_case_access_update on public.portal_case_access for update to authenticated using(
  public.caseflow_can_case(case_id,'cases.manage')) with check(
  public.caseflow_can_case(case_id,'cases.manage'));

revoke all on function public.protect_portal_case_access() from public,anon,authenticated;
revoke all on function public.caseflow_actor_portal() from public,anon;
grant execute on function public.caseflow_actor_portal() to authenticated,service_role;
grant execute on function public.caseflow_can_case(uuid,text) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
