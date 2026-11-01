begin;

-- Manager review is a durable hand-off, separate from ordinary office tasks.
-- Office task RLS intentionally lets all staff read office tasks; sensitive
-- manager reports must not inherit that access model.
create table public.manager_inbox (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null,
  kind text not null check (kind in ('client','report')),
  client_id uuid references public.clients(id) on delete restrict,
  title text not null check (length(btrim(title)) between 1 and 200),
  submitted_note text not null default '' check (length(submitted_note) <= 4000),
  source_path text not null check (length(source_path) <= 300 and source_path like '/staff/%'),
  snapshot jsonb not null default '{}'::jsonb check (octet_length(snapshot::text) <= 32768),
  submitted_by uuid not null references public.staff(id),
  submitted_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open','resolved')),
  destination text check (destination in ('keep_current','new_intake','account_setup','job_ready','appointments','payment_required','paperwork_pending','completed')),
  resolution_note text check (length(resolution_note) <= 2000),
  resolved_by uuid references public.staff(id),
  resolved_at timestamptz,
  routed_task_id uuid references public.tasks(id),
  check ((kind='client') = (client_id is not null)),
  check ((status='resolved') = (resolved_by is not null and resolved_at is not null and destination is not null)),
  unique (submitted_by,request_key)
);
create unique index manager_inbox_open_client on public.manager_inbox(client_id)
  where status='open' and client_id is not null;
create unique index manager_inbox_open_report on public.manager_inbox(submitted_by,source_path)
  where status='open' and kind='report';
create index manager_inbox_open_order on public.manager_inbox(submitted_at,id) where status='open';
create index manager_inbox_sender on public.manager_inbox(submitted_by,submitted_at desc);

alter table public.manager_inbox enable row level security;
-- Revoke authenticated defaults too: hosted projects can grant new tables
-- broad default privileges before these narrower column grants are applied.
revoke all on public.manager_inbox from public,anon,authenticated;
grant select on public.manager_inbox to authenticated;
grant insert(request_key,kind,client_id,title,submitted_note,source_path,snapshot,submitted_by) on public.manager_inbox to authenticated;
grant update(status,destination,resolution_note,resolved_by,resolved_at,routed_task_id) on public.manager_inbox to authenticated;
grant all on public.manager_inbox to service_role;

create policy manager_inbox_read on public.manager_inbox for select to authenticated
using (
  (public.cg_staff_role() in ('admin','manager') or submitted_by=public.cg_staff_id())
  and (kind<>'report' or public.cg_staff_role() in ('admin','manager'))
  and (client_id is null or public.cg_can_access_client(client_id))
);
create policy manager_inbox_submit on public.manager_inbox for insert to authenticated
with check (
  submitted_by=public.cg_staff_id() and status='open'
  and exists(select 1 from public.staff s where s.id=public.cg_staff_id() and s.active
    and (s.role in ('admin','manager') or s.permission_mode='full' or 'add_task'=any(s.custom_permissions)))
  and ((kind='client' and public.cg_can_access_client(client_id))
    or (kind='report' and client_id is null and public.cg_staff_role() in ('admin','manager')))
);
create policy manager_inbox_resolve on public.manager_inbox for update to authenticated
using (public.cg_staff_role() in ('admin','manager') and (client_id is null or public.cg_can_access_client(client_id)))
with check (public.cg_staff_role() in ('admin','manager') and (client_id is null or public.cg_can_access_client(client_id)));

-- Submission evidence cannot be rewritten and a resolution cannot be revised.
-- The caller remains subject to table RLS (no SECURITY DEFINER bypass).
create function career_gate_private.guard_manager_inbox() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.submitted_by is distinct from public.cg_staff_id() then
      raise exception 'manager_review_actor_mismatch' using errcode='42501';
    end if;
    new.submitted_at := now();
  else
    if row(new.request_key,new.kind,new.client_id,new.title,new.submitted_note,new.source_path,new.snapshot,new.submitted_by,new.submitted_at)
      is distinct from row(old.request_key,old.kind,old.client_id,old.title,old.submitted_note,old.source_path,old.snapshot,old.submitted_by,old.submitted_at) then
      raise exception 'manager_review_submission_is_immutable' using errcode='42501';
    end if;
    if old.status<>'open' or new.status<>'resolved'
      or new.resolved_by is distinct from public.cg_staff_id() then
      raise exception 'manager_review_resolution_is_final' using errcode='42501';
    end if;
    new.resolved_at := now();
  end if;
  return new;
end $$;
revoke all on function career_gate_private.guard_manager_inbox() from public,anon;
grant execute on function career_gate_private.guard_manager_inbox() to authenticated,service_role;
create trigger manager_inbox_guard before insert or update on public.manager_inbox
for each row execute function career_gate_private.guard_manager_inbox();

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='manager_inbox') then
    alter publication supabase_realtime add table public.manager_inbox;
  end if;
end $$;

commit;
