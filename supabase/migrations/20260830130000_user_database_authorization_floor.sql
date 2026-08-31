begin;

-- P1 database security floor. Fine-grained authorization remains in Node;
-- these functions independently prevent a user JWT from escaping its current
-- client/case/document boundary. They use the canonical authorization tables.

create or replace function public.caseflow_actor_id()
returns uuid language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare raw_sub text;
begin
  raw_sub := nullif(current_setting('request.jwt.claim.sub', true), '');
  if raw_sub is null then
    raw_sub := (nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'sub';
  end if;
  begin return raw_sub::uuid; exception when others then return null; end;
end;
$$;

create or replace function public.caseflow_actor_active()
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists(select 1 from public.app_users u
    where u.auth_user_id=public.caseflow_actor_id() and u.status='active')
$$;

create or replace function public.caseflow_actor_owner()
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select public.caseflow_actor_active() and exists(
    select 1 from public.user_roles r
    where r.auth_user_id=public.caseflow_actor_id() and r.role_code='owner')
$$;

create or replace function public.caseflow_actor_portal()
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select public.caseflow_actor_active()
    and exists(select 1 from public.user_roles r where r.auth_user_id=public.caseflow_actor_id())
    and not exists(select 1 from public.user_roles r where r.auth_user_id=public.caseflow_actor_id()
      and r.role_code not in ('client_owner','client_collaborator'))
$$;

create or replace function public.caseflow_has_permission(requested text)
returns boolean language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare actor uuid:=public.caseflow_actor_id(); decision boolean;
begin
  if not public.caseflow_actor_active() then return false; end if;
  if public.caseflow_actor_owner() then return true; end if;

  select case when requested=any(p.restrictions) then false
                   when requested=any(p.grants) then true end into decision
  from public.access_policies p where p.subject_type='user' and p.subject_id=actor::text;
  if decision is not null then return decision; end if;

  if exists(select 1 from public.access_policies p join public.team_members tm
      on p.subject_type='team' and p.subject_id=tm.team_id::text
      where tm.user_id=actor and requested=any(p.restrictions)) then return false; end if;
  if exists(select 1 from public.access_policies p join public.team_members tm
      on p.subject_type='team' and p.subject_id=tm.team_id::text
      where tm.user_id=actor and requested=any(p.grants)) then return true; end if;

  if exists(select 1 from public.access_policies p join public.user_roles ur
      on p.subject_type='role' and p.subject_id=ur.role_code
      where ur.auth_user_id=actor and requested=any(p.restrictions)) then return false; end if;
  if exists(select 1 from public.access_policies p join public.user_roles ur
      on p.subject_type='role' and p.subject_id=ur.role_code
      where ur.auth_user_id=actor and requested=any(p.grants)) then return true; end if;

  return exists(select 1 from public.user_roles ur join public.role_permissions rp
    on rp.role_code=ur.role_code where ur.auth_user_id=actor and rp.permission_code=requested);
end;
$$;

create or replace function public.caseflow_scope(module_name text)
returns text language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare actor uuid:=public.caseflow_actor_id(); selected text;
begin
  if public.caseflow_actor_owner() then return 'global'; end if;
  if not public.caseflow_actor_active() then return 'none'; end if;
  select p.scopes->>module_name into selected from public.access_policies p
    where p.subject_type='user' and p.subject_id=actor::text
      and p.scopes ? module_name;
  if selected is not null then return selected; end if;
  select x.scope into selected from (
    select p.scopes->>module_name scope,
      case p.scopes->>module_name when 'global' then 7 when 'team' then 6
      when 'assigned' then 5 when 'explicit_client' then 4
      when 'explicit_category' then 3 when 'explicit_case' then 2
      when 'client_self' then 1 else 0 end rank
    from public.access_policies p join public.team_members tm
      on p.subject_type='team' and p.subject_id=tm.team_id::text
    where tm.user_id=actor and p.scopes ? module_name
    order by rank desc limit 1) x;
  if selected is not null then return selected; end if;
  -- The narrowest applicable role policy is a fail-closed floor for users
  -- holding several roles; Node may authorize less, never more.
  select x.scope into selected from (
    select p.scopes->>module_name scope,
      case p.scopes->>module_name when 'global' then 7 when 'team' then 6
      when 'assigned' then 5 when 'explicit_client' then 4
      when 'explicit_category' then 3 when 'explicit_case' then 2
      when 'client_self' then 1 else 0 end rank
    from public.access_policies p join public.user_roles ur
      on p.subject_type='role' and p.subject_id=ur.role_code
    where ur.auth_user_id=actor and p.scopes ? module_name
    order by rank asc limit 1) x;
  if selected is not null then return selected; end if;
  return case when public.caseflow_actor_portal() then 'client_self' else 'global' end;
end;
$$;

create or replace function public.caseflow_subject_grant(
  target_type text, target_id uuid, target_key text, requested text, wanted_effect text)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select exists(
    select 1 from public.record_access_grants g
    where g.effect=wanted_effect and g.resource_type=target_type
      and ((target_id is not null and g.resource_id=target_id)
        or (target_key is not null and g.resource_key=target_key))
      and ((g.subject_type='user' and g.subject_id=public.caseflow_actor_id())
        or (g.subject_type='team' and exists(select 1 from public.team_members tm
          where tm.team_id=g.subject_id and tm.user_id=public.caseflow_actor_id())))
      and (wanted_effect='restrict' or cardinality(g.permissions)=0 or requested=any(g.permissions)))
$$;

create or replace function public.caseflow_can_case(case_uuid uuid, requested text)
returns boolean language plpgsql stable security definer
set search_path = public, pg_temp as $$
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
  if selected_scope='client_self' then return c.client_id is not null and exists(
    select 1 from public.client_access a where a.client_id=c.client_id and a.auth_user_id=actor and a.status='active'); end if;
  return false;
end;
$$;

create or replace function public.caseflow_can_client(client_uuid uuid, requested text)
returns boolean language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare selected_scope text;
begin
  if not public.caseflow_actor_active() or client_uuid is null
     or not exists(select 1 from public.clients where id=client_uuid and archived_at is null) then return false; end if;
  if public.caseflow_actor_owner() then return true; end if;
  if public.caseflow_subject_grant('client',client_uuid,null,requested,'restrict') then return false; end if;
  if not public.caseflow_has_permission(requested) then return false; end if;
  if public.caseflow_subject_grant('client',client_uuid,null,requested,'grant') then return true; end if;
  selected_scope:=public.caseflow_scope('clients');
  if selected_scope='global' then return true; end if;
  if selected_scope='client_self' then return exists(select 1 from public.client_access a
    where a.client_id=client_uuid and a.auth_user_id=public.caseflow_actor_id() and a.status='active'); end if;
  return exists(select 1 from public.cases c where c.client_id=client_uuid
    and public.caseflow_can_case(c.id,'cases.view'));
end;
$$;

create or replace function public.caseflow_document_integrity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare canonical_client uuid;
begin
  if new.case_id is null then raise exception 'Document case is required'; end if;
  select client_id into canonical_client from public.cases where id=new.case_id and archived_at is null;
  if not found then raise exception 'Document case does not exist'; end if;
  if new.client_id is distinct from canonical_client then raise exception 'Document client/case mismatch'; end if;
  if new.request_id is not null and not exists(select 1 from public.document_requests r
    where r.id=new.request_id and r.case_id=new.case_id and r.client_id is not distinct from new.client_id)
  then raise exception 'Document request/case mismatch'; end if;
  if new.person_id is not null and not exists(select 1 from public.case_people p
    where p.case_id=new.case_id and p.person_id=new.person_id)
  then raise exception 'Document participant/case mismatch'; end if;
  if public.caseflow_actor_id() is not null
     and new.object_key not like ('cases/'||new.case_id::text||'/%')
  then raise exception 'Document object key/case mismatch'; end if;
  return new;
end;
$$;

create or replace function public.caseflow_client_update_integrity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if public.caseflow_actor_portal() then
    if (to_jsonb(new)-'preferred_language'-'updated_by'-'updated_at')
       is distinct from (to_jsonb(old)-'preferred_language'-'updated_by'-'updated_at')
       or new.updated_by is distinct from public.caseflow_actor_id()
    then raise exception 'Portal client update is limited to language preferences'; end if;
  end if;
  return new;
end;
$$;

do $$ begin
  if not exists(select 1 from pg_trigger where tgrelid='public.documents'::regclass
    and tgname='documents_enforce_relationships' and not tgisinternal) then
    create trigger documents_enforce_relationships before insert or update of case_id,client_id,person_id,request_id,object_key
      on public.documents for each row execute function public.caseflow_document_integrity();
  end if;
end $$;

do $$ begin
  if not exists(select 1 from pg_trigger where tgrelid='public.clients'::regclass
    and tgname='clients_enforce_portal_update' and not tgisinternal) then
    create trigger clients_enforce_portal_update before update on public.clients
      for each row execute function public.caseflow_client_update_integrity();
  end if;
end $$;

-- Remove the historical authenticated deny policy only on user-facing tables;
-- backend-only authorization/job/configuration tables remain server-only.
do $$ declare t text; begin
  foreach t in array array['app_users','user_roles','teams','access_policies','record_access_grants','team_members','clients','people','client_people','client_access','cases','case_people','case_assignments','documents','document_requests','tasks','deadlines','alerts','appointments','case_notes','case_messages','invoices','payments','intake_definitions','intake_submissions','person_history_records','family_relationships','participant_match_reviews','form_registry','form_versions','form_definitions','form_rules','form_instances','form_answers','form_findings','background_jobs','generated_artifacts','ai_review_runs','ai_findings','controlled_document_templates','form_update_alerts','outbound_communications','import_batches','import_rows','office_settings','communication_templates','retention_policies','service_catalog','legal_holds','audit_events','case_events'] loop
    execute format('drop policy if exists server_only_no_direct_access on public.%I',t);
    execute format('drop policy if exists %I on public.%I',t||'_server_only',t);
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select on public.app_users,public.user_roles,public.clients,public.people,public.client_people,
  public.client_access,public.cases,public.case_people,public.case_assignments,public.documents,
  public.document_requests,public.tasks,public.deadlines,public.alerts,public.appointments,
  public.case_notes,public.case_messages,public.invoices,public.payments,public.intake_submissions,
  public.person_history_records,public.form_instances,public.form_answers,public.form_findings,
  public.generated_artifacts,public.outbound_communications,public.legal_holds,public.audit_events,
  public.case_events,public.teams,public.access_policies,public.record_access_grants,public.team_members,
  public.intake_definitions,public.family_relationships,public.participant_match_reviews,
  public.form_registry,public.form_versions,public.form_definitions,public.form_rules,public.background_jobs,
  public.ai_review_runs,public.ai_findings,public.controlled_document_templates,public.form_update_alerts,
  public.import_batches,public.import_rows,public.office_settings,public.communication_templates,
  public.retention_policies,public.service_catalog to authenticated;
grant insert,update on public.clients,public.people,public.client_people,public.client_access,public.cases,
  public.case_people,public.case_assignments,public.documents,public.document_requests,public.tasks,
  public.deadlines,public.alerts,public.appointments,public.case_notes,public.case_messages,public.invoices,
  public.payments,public.intake_submissions,public.person_history_records,public.form_instances,
  public.form_answers,public.form_findings,public.generated_artifacts,public.outbound_communications,
  public.legal_holds to authenticated;
grant insert,update on public.participant_match_reviews,public.background_jobs,public.ai_review_runs,
  public.ai_findings,public.import_batches,public.import_rows to authenticated;
grant insert,update on public.form_registry,public.form_versions,public.form_definitions,
  public.form_rules,public.form_update_alerts,public.office_settings,public.retention_policies to authenticated;
grant insert on public.audit_events,public.case_events to authenticated;
grant insert,update,delete on public.teams,public.team_members,public.access_policies,public.record_access_grants to authenticated;
grant delete on public.client_access,public.case_assignments,public.case_people,public.client_people to authenticated;
grant update(display_name,preferred_language,profile_object_key,updated_at) on public.app_users to authenticated;

create policy app_users_read_floor on public.app_users for select to authenticated using(
  public.caseflow_actor_active() and (auth_user_id=public.caseflow_actor_id() or public.caseflow_actor_owner()
    or public.caseflow_has_permission('users.view') or public.caseflow_has_permission('cases.manage')));
create policy app_users_profile_floor on public.app_users for update to authenticated using(
  public.caseflow_actor_active() and auth_user_id=public.caseflow_actor_id()) with check(
  public.caseflow_actor_active() and auth_user_id=public.caseflow_actor_id());
create policy user_roles_read_floor on public.user_roles for select to authenticated using(
  public.caseflow_actor_active() and (auth_user_id=public.caseflow_actor_id() or public.caseflow_actor_owner()
    or public.caseflow_has_permission('users.view')));
create policy teams_read_floor on public.teams for select to authenticated using(
  public.caseflow_actor_owner() or exists(select 1 from public.team_members tm
    where tm.team_id=id and tm.user_id=public.caseflow_actor_id()));
create policy teams_owner_write_floor on public.teams for all to authenticated using(
  public.caseflow_actor_owner()) with check(public.caseflow_actor_owner());

create policy clients_read_floor on public.clients for select to authenticated using(
  public.caseflow_can_client(id,'clients.view') or public.caseflow_can_client(id,'portal.view'));
create policy clients_insert_floor on public.clients for insert to authenticated with check(
  public.caseflow_actor_active() and public.caseflow_has_permission('clients.manage') and public.caseflow_scope('clients')='global');
create policy clients_update_floor on public.clients for update to authenticated using(
  public.caseflow_can_client(id,'clients.manage')) with check(public.caseflow_can_client(id,'clients.manage'));
create policy clients_portal_language_floor on public.clients for update to authenticated using(
  public.caseflow_can_client(id,'portal.view')) with check(
  public.caseflow_can_client(id,'portal.view') and updated_by=public.caseflow_actor_id());

create policy cases_read_floor on public.cases for select to authenticated using(
  public.caseflow_can_case(id,'cases.view') or public.caseflow_can_case(id,'portal.view'));
create policy cases_insert_floor on public.cases for insert to authenticated with check(
  public.caseflow_can_client(client_id,'clients.view') and public.caseflow_has_permission('cases.manage'));
create policy cases_update_floor on public.cases for update to authenticated using(
  public.caseflow_can_case(id,'cases.manage')) with check(
  public.caseflow_can_client(client_id,'clients.view') and public.caseflow_has_permission('cases.manage'));

create policy documents_read_floor on public.documents for select to authenticated using(
  public.caseflow_can_case(case_id,'documents.view') or public.caseflow_can_case(case_id,'portal.documents'));
create policy documents_insert_floor on public.documents for insert to authenticated with check(
  (public.caseflow_can_case(case_id,'documents.manage') or public.caseflow_can_case(case_id,'portal.documents'))
  and client_id is not distinct from (select c.client_id from public.cases c where c.id=case_id));
create policy documents_update_floor on public.documents for update to authenticated using(
  public.caseflow_can_case(case_id,'documents.manage') or public.caseflow_can_case(case_id,'documents.review')) with check(
  (public.caseflow_can_case(case_id,'documents.manage') or public.caseflow_can_case(case_id,'documents.review'))
  and client_id is not distinct from (select c.client_id from public.cases c where c.id=case_id));

create policy client_access_read_floor on public.client_access for select to authenticated using(
  public.caseflow_actor_active() and (auth_user_id=public.caseflow_actor_id() or public.caseflow_actor_owner()
    or public.caseflow_can_client(client_id,'clients.view')));
create policy client_access_insert_floor on public.client_access for insert to authenticated with check(
  public.caseflow_can_client(client_id,'clients.manage'));
create policy client_access_update_floor on public.client_access for update to authenticated using(
  public.caseflow_can_client(client_id,'clients.manage')) with check(public.caseflow_can_client(client_id,'clients.manage'));
create policy client_access_delete_floor on public.client_access for delete to authenticated using(
  public.caseflow_can_client(client_id,'clients.manage'));

create policy case_assignments_read_floor on public.case_assignments for select to authenticated using(
  public.caseflow_actor_active() and (auth_user_id=public.caseflow_actor_id() or public.caseflow_actor_owner()
    or public.caseflow_can_case(case_id,'cases.view')));
create policy case_assignments_write_floor on public.case_assignments for all to authenticated using(
  public.caseflow_can_case(case_id,'cases.manage')) with check(public.caseflow_can_case(case_id,'cases.manage'));

create policy case_people_read_floor on public.case_people for select to authenticated using(
  public.caseflow_can_case(case_id,'cases.view') or public.caseflow_can_case(case_id,'portal.view'));
create policy case_people_write_floor on public.case_people for all to authenticated using(
  public.caseflow_can_case(case_id,'cases.manage')) with check(public.caseflow_can_case(case_id,'cases.manage'));
create policy client_people_read_floor on public.client_people for select to authenticated using(
  public.caseflow_can_client(client_id,'clients.view') or public.caseflow_can_client(client_id,'portal.view'));
create policy client_people_write_floor on public.client_people for all to authenticated using(
  public.caseflow_can_client(client_id,'clients.manage')) with check(public.caseflow_can_client(client_id,'clients.manage'));
create policy people_read_floor on public.people for select to authenticated using(
  public.caseflow_actor_owner() or exists(select 1 from public.client_people cp where cp.person_id=id and
    (public.caseflow_can_client(cp.client_id,'clients.view') or public.caseflow_can_client(cp.client_id,'portal.view')))
  or exists(select 1 from public.case_people cp where cp.person_id=id and
    (public.caseflow_can_case(cp.case_id,'cases.view') or public.caseflow_can_case(cp.case_id,'portal.view'))));
create policy people_insert_floor on public.people for insert to authenticated with check(
  public.caseflow_actor_active() and (public.caseflow_has_permission('clients.manage') or public.caseflow_has_permission('cases.manage')));
create policy people_update_floor on public.people for update to authenticated using(
  public.caseflow_actor_owner() or exists(select 1 from public.case_people cp where cp.person_id=id and public.caseflow_can_case(cp.case_id,'cases.manage')))
  with check(public.caseflow_actor_active());

-- Case-linked resources share one immutable ownership boundary.
do $$ declare item record; begin
  for item in select * from (values
    ('document_requests','documents.view','documents.manage'),('tasks','tasks.view','tasks.manage'),
    ('deadlines','tasks.view','tasks.manage'),('appointments','cases.view','cases.manage'),
    ('case_notes','cases.view','cases.manage'),('case_messages','cases.view','cases.manage'),
    ('intake_submissions','cases.view','cases.manage'),('person_history_records','cases.view','cases.manage'),
    ('form_instances','cases.view','cases.prepare'),('form_findings','cases.view','cases.prepare'),
    ('generated_artifacts','documents.view','cases.prepare'),('outbound_communications','cases.view','cases.manage'),
    ('legal_holds','settings.manage','settings.manage')) as v(table_name,read_permission,write_permission)
  loop
    execute format('create policy %I on public.%I for select to authenticated using(public.caseflow_can_case(case_id,%L))',item.table_name||'_read_floor',item.table_name,item.read_permission);
    execute format('create policy %I on public.%I for all to authenticated using(public.caseflow_can_case(case_id,%L)) with check(public.caseflow_can_case(case_id,%L))',item.table_name||'_write_floor',item.table_name,item.write_permission,item.write_permission);
  end loop;
end $$;

create policy form_answers_read_floor on public.form_answers for select to authenticated using(exists(
  select 1 from public.form_instances f where f.id=form_instance_id and public.caseflow_can_case(f.case_id,'cases.view')));
create policy form_answers_write_floor on public.form_answers for all to authenticated using(exists(
  select 1 from public.form_instances f where f.id=form_instance_id and public.caseflow_can_case(f.case_id,'cases.prepare')))
  with check(exists(select 1 from public.form_instances f where f.id=form_instance_id and public.caseflow_can_case(f.case_id,'cases.prepare')));

create policy alerts_read_floor on public.alerts for select to authenticated using(
  (case_id is not null and public.caseflow_can_case(case_id,'dashboard.view'))
  or (case_id is null and client_id is not null and public.caseflow_can_client(client_id,'clients.view')));
create policy alerts_write_floor on public.alerts for all to authenticated using(
  (case_id is not null and public.caseflow_can_case(case_id,'tasks.manage'))
  or (case_id is null and client_id is not null and public.caseflow_can_client(client_id,'clients.view')))
  with check((case_id is not null and public.caseflow_can_case(case_id,'tasks.manage'))
  or (case_id is null and client_id is not null and public.caseflow_can_client(client_id,'clients.view')));

create policy invoices_read_floor on public.invoices for select to authenticated using(
  (case_id is not null and public.caseflow_can_case(case_id,'billing.view'))
  or (case_id is null and public.caseflow_can_client(client_id,'billing.view')));
create policy invoices_write_floor on public.invoices for all to authenticated using(
  (case_id is not null and public.caseflow_can_case(case_id,'billing.manage'))
  or (case_id is null and public.caseflow_can_client(client_id,'billing.manage')))
  with check((case_id is not null and public.caseflow_can_case(case_id,'billing.manage'))
  or (case_id is null and public.caseflow_can_client(client_id,'billing.manage')));
create policy payments_read_floor on public.payments for select to authenticated using(exists(
  select 1 from public.invoices i where i.id=invoice_id and ((i.case_id is not null and public.caseflow_can_case(i.case_id,'billing.view')) or public.caseflow_can_client(i.client_id,'billing.view'))));
create policy payments_write_floor on public.payments for all to authenticated using(exists(
  select 1 from public.invoices i where i.id=invoice_id and ((i.case_id is not null and public.caseflow_can_case(i.case_id,'billing.manage')) or public.caseflow_can_client(i.client_id,'billing.manage'))))
  with check(exists(select 1 from public.invoices i where i.id=invoice_id and ((i.case_id is not null and public.caseflow_can_case(i.case_id,'billing.manage')) or public.caseflow_can_client(i.client_id,'billing.manage'))));

-- Participant relationship and duplicate-review records inherit the same
-- client/case boundary as their canonical parent.
create policy family_relationships_read_floor on public.family_relationships for select to authenticated using(
  public.caseflow_can_client(client_id,'clients.view') or public.caseflow_can_client(client_id,'portal.view'));
create policy family_relationships_write_floor on public.family_relationships for all to authenticated using(
  public.caseflow_can_client(client_id,'clients.manage')) with check(public.caseflow_can_client(client_id,'clients.manage'));
create policy participant_match_reviews_read_floor on public.participant_match_reviews for select to authenticated using(
  public.caseflow_can_case(case_id,'cases.view'));
create policy participant_match_reviews_write_floor on public.participant_match_reviews for all to authenticated using(
  public.caseflow_can_case(case_id,'cases.manage')) with check(public.caseflow_can_case(case_id,'cases.manage'));

-- Case-owned jobs and AI records cannot be addressed outside the case. AI
-- mutation additionally remains Owner-only, matching the Node approval gate.
create policy background_jobs_read_floor on public.background_jobs for select to authenticated using(
  case_id is not null and public.caseflow_can_case(case_id,'cases.view'));
create policy background_jobs_write_floor on public.background_jobs for all to authenticated using(
  case_id is not null and (public.caseflow_can_case(case_id,'cases.prepare') or public.caseflow_actor_owner()))
  with check(case_id is not null and (public.caseflow_can_case(case_id,'cases.prepare') or public.caseflow_actor_owner()));
create policy ai_review_runs_owner_floor on public.ai_review_runs for all to authenticated using(
  public.caseflow_actor_owner() and public.caseflow_can_case(case_id,'cases.view'))
  with check(public.caseflow_actor_owner() and public.caseflow_can_case(case_id,'cases.view'));
create policy ai_findings_owner_floor on public.ai_findings for all to authenticated using(
  public.caseflow_actor_owner() and public.caseflow_can_case(case_id,'cases.view'))
  with check(public.caseflow_actor_owner() and public.caseflow_can_case(case_id,'cases.view'));

-- Canonical form sources are readable only by active users whose work needs
-- them. Source changes remain behind access.manage (Owner by default).
create policy form_registry_read_floor on public.form_registry for select to authenticated using(
  public.caseflow_actor_active() and (public.caseflow_has_permission('cases.view') or public.caseflow_has_permission('portal.view')));
create policy form_registry_write_floor on public.form_registry for all to authenticated using(
  public.caseflow_has_permission('access.manage')) with check(public.caseflow_has_permission('access.manage'));
create policy form_versions_read_floor on public.form_versions for select to authenticated using(
  public.caseflow_actor_active() and (public.caseflow_has_permission('cases.view') or public.caseflow_has_permission('portal.view')));
create policy form_versions_write_floor on public.form_versions for all to authenticated using(
  public.caseflow_has_permission('access.manage')) with check(public.caseflow_has_permission('access.manage'));
create policy form_definitions_read_floor on public.form_definitions for select to authenticated using(
  public.caseflow_actor_active() and (public.caseflow_has_permission('cases.view') or public.caseflow_has_permission('portal.view')));
create policy form_definitions_write_floor on public.form_definitions for all to authenticated using(
  public.caseflow_has_permission('access.manage')) with check(public.caseflow_has_permission('access.manage'));
create policy form_rules_read_floor on public.form_rules for select to authenticated using(
  public.caseflow_actor_active() and public.caseflow_has_permission('cases.view'));
create policy form_rules_write_floor on public.form_rules for all to authenticated using(
  public.caseflow_has_permission('access.manage')) with check(public.caseflow_has_permission('access.manage'));
create policy controlled_document_templates_read_floor on public.controlled_document_templates for select to authenticated using(
  public.caseflow_actor_active() and public.caseflow_has_permission('cases.prepare'));
create policy form_update_alerts_owner_floor on public.form_update_alerts for all to authenticated using(
  public.caseflow_has_permission('access.manage')) with check(public.caseflow_has_permission('access.manage'));

-- Import staging contains sensitive raw client data. Only users with the
-- dedicated import permission may see or mutate it; portal roles never can.
create policy import_batches_floor on public.import_batches for all to authenticated using(
  public.caseflow_actor_active() and public.caseflow_has_permission('imports.manage'))
  with check(public.caseflow_actor_active() and public.caseflow_has_permission('imports.manage'));
create policy import_rows_floor on public.import_rows for all to authenticated using(
  public.caseflow_actor_active() and public.caseflow_has_permission('imports.manage') and exists(
    select 1 from public.import_batches b where b.id=batch_id))
  with check(public.caseflow_actor_active() and public.caseflow_has_permission('imports.manage') and exists(
    select 1 from public.import_batches b where b.id=batch_id));

-- Office/configuration tables are never public. Active authenticated users get
-- only the catalogue reads required by their current permission; writes stay
-- with the corresponding administrative permission.
create policy service_catalog_read_floor on public.service_catalog for select to authenticated using(
  public.caseflow_actor_active() and (public.caseflow_has_permission('dashboard.view') or public.caseflow_has_permission('cases.prepare')));
create policy intake_definitions_read_floor on public.intake_definitions for select to authenticated using(
  public.caseflow_actor_active() and (public.caseflow_has_permission('cases.view') or public.caseflow_has_permission('portal.intake')));
create policy office_settings_read_floor on public.office_settings for select to authenticated using(
  public.caseflow_actor_active() and (public.caseflow_has_permission('settings.manage')
    or public.caseflow_has_permission('cases.manage')));
create policy office_settings_write_floor on public.office_settings for update to authenticated using(
  public.caseflow_actor_active() and public.caseflow_has_permission('settings.manage'))
  with check(public.caseflow_actor_active() and public.caseflow_has_permission('settings.manage'));
create policy communication_templates_read_floor on public.communication_templates for select to authenticated using(
  public.caseflow_actor_active() and public.caseflow_has_permission('cases.manage'));
create policy retention_policies_read_floor on public.retention_policies for select to authenticated using(
  public.caseflow_actor_active() and public.caseflow_has_permission('settings.manage'));
create policy retention_policies_write_floor on public.retention_policies for all to authenticated using(
  public.caseflow_actor_active() and public.caseflow_has_permission('settings.manage'))
  with check(public.caseflow_actor_active() and public.caseflow_has_permission('settings.manage'));

-- Portal-visible operational records are still case/client scoped and expose
-- only rows explicitly marked for clients where such a marker exists.
create policy document_requests_portal_read_floor on public.document_requests for select to authenticated using(
  public.caseflow_can_case(case_id,'portal.documents'));
create policy case_messages_portal_read_floor on public.case_messages for select to authenticated using(
  public.caseflow_can_case(case_id,'portal.messages'));
create policy case_messages_portal_insert_floor on public.case_messages for insert to authenticated with check(
  public.caseflow_can_case(case_id,'portal.messages') and sender_type='client'
  and sender_user_id=public.caseflow_actor_id());
create policy case_notes_portal_read_floor on public.case_notes for select to authenticated using(
  visibility='client' and public.caseflow_can_case(case_id,'portal.view'));
create policy appointments_portal_read_floor on public.appointments for select to authenticated using(
  client_visible and ((case_id is not null and public.caseflow_can_case(case_id,'portal.view'))
    or (case_id is null and public.caseflow_can_client(client_id,'portal.view'))));
create policy deadlines_portal_read_floor on public.deadlines for select to authenticated using(
  client_visible and public.caseflow_can_case(case_id,'portal.view'));
create policy alerts_portal_read_floor on public.alerts for select to authenticated using(
  client_visible and ((case_id is not null and public.caseflow_can_case(case_id,'portal.view'))
    or (case_id is null and client_id is not null and public.caseflow_can_client(client_id,'portal.view'))));
create policy invoices_portal_read_floor on public.invoices for select to authenticated using(
  client_visible and ((case_id is not null and public.caseflow_can_case(case_id,'portal.view'))
    or (case_id is null and public.caseflow_can_client(client_id,'portal.view'))));
create policy outbound_communications_portal_read_floor on public.outbound_communications for select to authenticated using(
  status in ('sent','delivered') and public.caseflow_can_case(case_id,'portal.view'));
create policy intake_submissions_portal_read_floor on public.intake_submissions for select to authenticated using(
  public.caseflow_can_case(case_id,'portal.intake'));
create policy intake_submissions_portal_write_floor on public.intake_submissions for all to authenticated using(
  public.caseflow_can_case(case_id,'portal.intake')) with check(public.caseflow_can_case(case_id,'portal.intake'));

create policy audit_events_read_floor on public.audit_events for select to authenticated using(
  public.caseflow_actor_owner() or (case_id is not null and public.caseflow_can_case(case_id,'audit.view')));
create policy audit_events_insert_floor on public.audit_events for insert to authenticated with check(
  public.caseflow_actor_active() and actor_user_id=public.caseflow_actor_id());
create policy case_events_read_floor on public.case_events for select to authenticated using(
  public.caseflow_can_case(case_id,'audit.view') or public.caseflow_can_case(case_id,'cases.view'));
create policy case_events_insert_floor on public.case_events for insert to authenticated with check(
  public.caseflow_actor_active() and actor_user_id=public.caseflow_actor_id() and public.caseflow_can_case(case_id,'cases.view'));

-- Only the rows needed to resolve the current principal are visible.
create policy access_policies_floor on public.access_policies for select to authenticated using(
  public.caseflow_actor_owner() or (subject_type='user' and subject_id=public.caseflow_actor_id()::text)
  or (subject_type='role' and exists(select 1 from public.user_roles r where r.auth_user_id=public.caseflow_actor_id() and r.role_code=subject_id))
  or (subject_type='team' and exists(select 1 from public.team_members t where t.user_id=public.caseflow_actor_id() and t.team_id::text=subject_id)));
create policy record_access_grants_floor on public.record_access_grants for select to authenticated using(
  public.caseflow_actor_owner() or (subject_type='user' and subject_id=public.caseflow_actor_id())
  or (subject_type='team' and exists(select 1 from public.team_members t where t.user_id=public.caseflow_actor_id() and t.team_id=subject_id)));
create policy team_members_floor on public.team_members for select to authenticated using(
  public.caseflow_actor_owner() or user_id=public.caseflow_actor_id());
create policy access_policies_owner_write_floor on public.access_policies for all to authenticated using(
  public.caseflow_actor_owner()) with check(public.caseflow_actor_owner());
create policy record_access_grants_owner_write_floor on public.record_access_grants for all to authenticated using(
  public.caseflow_actor_owner()) with check(public.caseflow_actor_owner());
create policy team_members_owner_write_floor on public.team_members for all to authenticated using(
  public.caseflow_actor_owner()) with check(public.caseflow_actor_owner());

revoke all on function public.caseflow_actor_id() from public,anon;
revoke all on function public.caseflow_actor_active() from public,anon;
revoke all on function public.caseflow_actor_owner() from public,anon;
revoke all on function public.caseflow_actor_portal() from public,anon;
revoke all on function public.caseflow_has_permission(text) from public,anon;
revoke all on function public.caseflow_scope(text) from public,anon;
revoke all on function public.caseflow_subject_grant(text,uuid,text,text,text) from public,anon;
revoke all on function public.caseflow_can_case(uuid,text) from public,anon;
revoke all on function public.caseflow_can_client(uuid,text) from public,anon;
revoke all on function public.caseflow_client_update_integrity() from public,anon,authenticated;
grant execute on function public.caseflow_actor_id(),public.caseflow_actor_active(),public.caseflow_actor_owner(),
  public.caseflow_actor_portal(),public.caseflow_has_permission(text),public.caseflow_scope(text),
  public.caseflow_subject_grant(text,uuid,text,text,text),public.caseflow_can_case(uuid,text),
  public.caseflow_can_client(uuid,text) to authenticated,service_role;

notify pgrst, 'reload schema';
commit;
