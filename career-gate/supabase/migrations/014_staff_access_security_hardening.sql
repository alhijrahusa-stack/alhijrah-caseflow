-- Career Gate staff identity, access policy, roster migration, RLS alignment,
-- and least-privilege EXECUTE grants. In-place only; no table rebuilds.

alter table public.staff add column if not exists legacy_code text;
alter table public.staff add column if not exists access_scope text not null default 'full';

alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check
  check (role in ('super_admin','admin','manager','staff'));

alter table public.staff drop constraint if exists staff_access_scope_check;
alter table public.staff add constraint staff_access_scope_check
  check (access_scope in ('full','assigned_only'));

create unique index if not exists staff_email_ci_unique
  on public.staff (lower(email)) where email is not null;
create unique index if not exists staff_legacy_code_unique
  on public.staff (legacy_code) where legacy_code is not null;

-- Production roster: stable UUIDs preserve every existing FK/history link.
-- Detach the existing alhijrahusa@gmail.com auth identity from Abdullah before
-- assigning that email/auth identity to Yusuf.
update public.staff
set display_name = 'عبدالله عبدالحكيم المريسي',
    email = 'careergate.official@gmail.com',
    role = 'super_admin',
    active = true,
    auth_user_id = null,
    staff_code = 'AHS-SA-0101',
    legacy_code = 'AHS-SA-101',
    access_scope = 'full',
    updated_at = now()
where id = 'af25f228-3ffc-452d-8f3b-b83267fb173f'::uuid;

update public.staff
set display_name = 'صلاح عبدالحكيم',
    email = 'salahkiarry2025@gmail.com',
    role = 'admin',
    active = true,
    staff_code = 'AHS-AD-0102',
    legacy_code = 'AHS-AD-102',
    access_scope = 'full',
    updated_at = now()
where id = 'b774e907-2083-43f7-b6b1-2b0b2b6a032c'::uuid;

update public.staff
set display_name = 'محمد عبدالحكيم',
    email = 'abunoran92@gmail.com',
    role = 'staff',
    active = true,
    staff_code = 'AHS-CG-0103',
    legacy_code = 'AHS-CG-103',
    access_scope = 'full',
    updated_at = now()
where id = '5f169d76-dc80-4485-9b95-9542913ed63a'::uuid;

update public.staff
set display_name = 'يوسف عبدالحكيم',
    email = 'alhijrahusa@gmail.com',
    role = 'staff',
    active = true,
    auth_user_id = (
      select u.id from auth.users u
      where lower(u.email) = 'alhijrahusa@gmail.com'
      order by u.created_at limit 1
    ),
    staff_code = 'AHS-CG-0104',
    legacy_code = 'AHS-CG-104',
    access_scope = 'full',
    updated_at = now()
where id = '89f42ff9-154c-4b3d-9843-e19701bb4a58'::uuid;

update public.staff
set display_name = 'أنس عبدالحكيم',
    email = 'abwmyasalmrysy570@gmail.com',
    role = 'staff',
    active = true,
    staff_code = 'AHS-CG-0105',
    legacy_code = 'AHS-CG-105',
    access_scope = 'full',
    updated_at = now()
where id = '46170ffd-640d-4c78-a782-2202b7b6a6ee'::uuid;

update public.staff
set display_name = 'فاطمة عبدالحكيم',
    email = 'abdullahayz93@gmail.com',
    role = 'staff',
    active = true,
    staff_code = 'AHS-CG-0106',
    legacy_code = 'AHS-CG-106',
    access_scope = 'full',
    updated_at = now()
where id = '3ac5ce29-b210-4a0f-9b3c-07bb195cadd7'::uuid;

create or replace function public.cg_staff_id()
returns uuid language sql stable security definer set search_path=public as $$
  select id from public.staff where auth_user_id = auth.uid() and active;
$$;

create or replace function public.cg_staff_role()
returns text language sql stable security definer set search_path=public as $$
  select role from public.staff where auth_user_id = auth.uid() and active;
$$;

create or replace function public.cg_can_access_client(cid uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1
    from public.clients c, public.staff s
    where c.id = cid
      and s.auth_user_id = auth.uid()
      and s.active
      and (
        s.role = 'super_admin'
        or (
          c.deleted_at is null
          and (s.access_scope = 'full' or c.assigned_staff = s.id)
        )
      )
  );
$$;

create or replace function public.cg_can_access_client_row(p_assigned uuid, p_deleted_at timestamptz)
returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.staff s
    where s.auth_user_id = auth.uid()
      and s.active
      and (
        s.role = 'super_admin'
        or (
          p_deleted_at is null
          and (s.access_scope = 'full' or p_assigned = s.id)
        )
      )
  );
$$;

-- Current policy: every active staff member has full operational capability.
-- access_scope lets Super Admin reduce a user to assigned-client-only later.
drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients for insert to authenticated
  with check (public.cg_staff_id() is not null);

drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients for update to authenticated
  using (public.cg_can_access_client_row(assigned_staff, deleted_at))
  with check (
    public.cg_can_access_client_row(assigned_staff, deleted_at)
    or public.cg_staff_role() = 'super_admin'
  );

drop policy if exists audit_alerts_scope on public.audit_alerts;
create policy audit_alerts_scope on public.audit_alerts for all to authenticated
  using (public.cg_can_access_client(client_id))
  with check (public.cg_can_access_client(client_id));

drop policy if exists blocked_periods_write on public.blocked_periods;
create policy blocked_periods_write on public.blocked_periods for all to authenticated
  using (public.cg_staff_id() is not null)
  with check (public.cg_staff_id() is not null);

drop policy if exists office_availability_write on public.office_availability;
create policy office_availability_write on public.office_availability for all to authenticated
  using (public.cg_staff_id() is not null)
  with check (public.cg_staff_id() is not null);

drop policy if exists accounts_insert on public.client_accounts;
create policy accounts_insert on public.client_accounts for insert to authenticated
  with check (public.cg_staff_id() is not null);

drop policy if exists accounts_update on public.client_accounts;
create policy accounts_update on public.client_accounts for update to authenticated
  using (public.cg_staff_id() is not null)
  with check (public.cg_staff_id() is not null);

drop policy if exists transfer_read on public.ownership_transfer_requests;
create policy transfer_read on public.ownership_transfer_requests for select to authenticated
  using (public.cg_staff_id() is not null);

drop policy if exists transfer_update on public.ownership_transfer_requests;
create policy transfer_update on public.ownership_transfer_requests for update to authenticated
  using (public.cg_staff_id() is not null)
  with check (public.cg_staff_id() is not null);

drop policy if exists assignment_settings_update on public.assignment_settings;
create policy assignment_settings_update on public.assignment_settings for update to authenticated
  using (public.cg_staff_role() = 'super_admin')
  with check (public.cg_staff_role() = 'super_admin');

drop policy if exists staff_admin_insert on public.staff;
create policy staff_admin_insert on public.staff for insert to authenticated
  with check (public.cg_staff_role() = 'super_admin');

drop policy if exists staff_admin_update on public.staff;
create policy staff_admin_update on public.staff for update to authenticated
  using (public.cg_staff_role() = 'super_admin')
  with check (public.cg_staff_role() = 'super_admin');

create table if not exists public.staff_security_audit (
  id bigint generated always as identity primary key,
  actor_staff_id uuid not null references public.staff(id),
  target_staff_id uuid not null references public.staff(id),
  action text not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);
alter table public.staff_security_audit enable row level security;
drop policy if exists staff_security_audit_super_admin on public.staff_security_audit;
create policy staff_security_audit_super_admin on public.staff_security_audit for all to authenticated
  using (public.cg_staff_role() = 'super_admin')
  with check (public.cg_staff_role() = 'super_admin');
grant select, insert on public.staff_security_audit to authenticated;

-- SECURITY DEFINER functions are private by default. Grant only callers that
-- require them; anonymous users cannot invoke privileged internal RPCs.
revoke execute on function public.assign_client_round_robin() from public, anon;
revoke execute on function public.cg_busy_intervals(text,timestamptz,timestamptz) from public, anon;
revoke execute on function public.cg_can_access_client(uuid) from public, anon;
revoke execute on function public.cg_can_access_client_row(uuid,timestamptz) from public, anon;
revoke execute on function public.cg_staff_id() from public, anon;
revoke execute on function public.cg_staff_role() from public, anon;
revoke execute on function public.enqueue_job(text,text,jsonb,text,text,integer,timestamptz) from public, anon;
revoke execute on function public.escalate_stale_applications() from public, anon;
revoke execute on function public.expire_stale_jobs() from public, anon;
revoke execute on function public.hide_dormant_profiles() from public, anon;
revoke execute on function public.match_candidates(uuid,integer) from public, anon;
revoke execute on function public.match_jobs(uuid,integer) from public, anon;
revoke execute on function public.next_client_ref() from public, anon;
revoke execute on function public.next_staff_code() from public, anon;
revoke execute on function public.prune_otp_logs() from public, anon;
revoke execute on function public.record_delivery_status(text,text,text,timestamptz,bytea,text,text) from public, anon;

grant execute on function public.cg_busy_intervals(text,timestamptz,timestamptz) to authenticated;
grant execute on function public.cg_can_access_client(uuid) to authenticated;
grant execute on function public.cg_can_access_client_row(uuid,timestamptz) to authenticated;
grant execute on function public.cg_staff_id() to authenticated;
grant execute on function public.cg_staff_role() to authenticated;
grant execute on function public.enqueue_job(text,text,jsonb,text,text,integer,timestamptz) to authenticated;
grant execute on function public.match_candidates(uuid,integer) to authenticated;
grant execute on function public.match_jobs(uuid,integer) to authenticated;
grant execute on function public.next_client_ref() to authenticated;
grant execute on function public.next_staff_code() to authenticated;

grant execute on function public.escalate_stale_applications() to service_role;
grant execute on function public.expire_stale_jobs() to service_role;
grant execute on function public.hide_dormant_profiles() to service_role;
grant execute on function public.prune_otp_logs() to service_role;
grant execute on function public.record_delivery_status(text,text,text,timestamptz,bytea,text,text) to service_role;
