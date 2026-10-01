-- Staff / HR / Asset lifecycle. Extend the existing staff identity; do not
-- introduce a competing staff model.

begin;

alter table public.staff
  add column if not exists phone text,
  add column if not exists date_of_birth date,
  add column if not exists address_line1 text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists postal_code text,
  add column if not exists qualification text,
  add column if not exists job_title text,
  add column if not exists join_date date,
  add column if not exists employment_type text,
  add column if not exists department text,
  add column if not exists photo_storage_path text;

alter table public.staff drop constraint if exists staff_employment_type_check;
alter table public.staff add constraint staff_employment_type_check check (
  employment_type is null or employment_type in ('full_time','part_time','contractor','temporary','other')
);

create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null unique check (length(trim(asset_code)) > 0),
  asset_type text not null check (asset_type in ('phone','laptop','tablet','other')),
  ownership text not null check (ownership in ('office','personal')),
  brand text,
  model text,
  serial_number text,
  condition text not null default 'good' check (condition in ('new','good','fair','damaged','repair')),
  status text not null default 'available' check (status in ('available','assigned','in_use','maintenance','returned','retired')),
  note text,
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ownership <> 'office' or serial_number is not null or asset_code is not null)
);
create unique index if not exists assets_serial_uidx on public.assets(serial_number) where serial_number is not null;
create index if not exists assets_type_status_idx on public.assets(asset_type,status);

create table if not exists public.asset_assignments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete restrict,
  staff_id uuid not null references public.staff(id) on delete restrict,
  issued_at timestamptz not null,
  issued_by uuid references public.staff(id),
  issue_condition text check (issue_condition is null or issue_condition in ('new','good','fair','damaged','repair')),
  return_due_at timestamptz,
  returned_at timestamptz,
  returned_by uuid references public.staff(id),
  return_condition text check (return_condition is null or return_condition in ('new','good','fair','damaged','repair')),
  status text not null default 'assigned' check (status in ('assigned','in_use','maintenance','returned','cancelled')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (returned_at is null or returned_at >= issued_at),
  check (status <> 'returned' or returned_at is not null)
);
create unique index if not exists asset_assignments_one_active_idx
  on public.asset_assignments(asset_id)
  where status in ('assigned','in_use','maintenance');
create index if not exists asset_assignments_staff_status_idx
  on public.asset_assignments(staff_id,status,issued_at desc);

create or replace function public.sync_asset_lifecycle()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  new.updated_at := now();
  if new.status='returned' then
    update public.assets set status='returned', condition=coalesce(new.return_condition,condition), updated_at=now()
     where id=new.asset_id;
  elsif new.status='maintenance' then
    update public.assets set status='maintenance', updated_at=now() where id=new.asset_id;
  elsif new.status in ('assigned','in_use') then
    update public.assets set status=new.status, updated_at=now() where id=new.asset_id;
  end if;
  return new;
end;
$$;

drop trigger if exists asset_assignments_sync on public.asset_assignments;
create trigger asset_assignments_sync
before insert or update of status,return_condition,returned_at on public.asset_assignments
for each row execute function public.sync_asset_lifecycle();

create or replace function public.touch_asset()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$ begin new.updated_at:=now(); return new; end $$;
drop trigger if exists assets_touch on public.assets;
create trigger assets_touch before update on public.assets for each row execute function public.touch_asset();

alter table public.assets enable row level security;
alter table public.asset_assignments enable row level security;

drop policy if exists assets_staff_read on public.assets;
drop policy if exists assets_management_write on public.assets;
create policy assets_staff_read on public.assets
  for select to authenticated using (
    public.cg_staff_role() in ('admin','manager') or exists (
      select 1 from public.asset_assignments aa
       where aa.asset_id=assets.id and aa.staff_id=public.cg_staff_id()
         and aa.status in ('assigned','in_use','maintenance')
    )
  );
create policy assets_management_write on public.assets
  for all to authenticated using (public.cg_staff_role() in ('admin','manager'))
  with check (public.cg_staff_role() in ('admin','manager'));

drop policy if exists asset_assignments_staff_read on public.asset_assignments;
drop policy if exists asset_assignments_management_write on public.asset_assignments;
create policy asset_assignments_staff_read on public.asset_assignments
  for select to authenticated using (
    staff_id=public.cg_staff_id() or public.cg_staff_role() in ('admin','manager')
  );
create policy asset_assignments_management_write on public.asset_assignments
  for all to authenticated using (public.cg_staff_role() in ('admin','manager'))
  with check (public.cg_staff_role() in ('admin','manager'));

grant select,insert,update on public.assets to authenticated;
revoke delete on public.assets from authenticated;
grant select,insert,update on public.asset_assignments to authenticated;
revoke delete on public.asset_assignments from authenticated;

-- Staff photos remain private server-managed objects. Harden hosted Storage if
-- its richer bucket columns are available; local CI intentionally lacks them.
do $$
declare
  has_size_limit boolean;
  has_mime_limit boolean;
begin
  if to_regclass('storage.buckets') is null then return; end if;
  select exists(select 1 from information_schema.columns where table_schema='storage' and table_name='buckets' and column_name='file_size_limit') into has_size_limit;
  select exists(select 1 from information_schema.columns where table_schema='storage' and table_name='buckets' and column_name='allowed_mime_types') into has_mime_limit;

  execute $sql$insert into storage.buckets(id,name,public) values('staff-assets','staff-assets',false) on conflict(id) do update set public=false$sql$;
  if has_size_limit then
    execute $sql$update storage.buckets set file_size_limit=4194304 where id='staff-assets'$sql$;
  end if;
  if has_mime_limit then
    execute $sql$update storage.buckets set allowed_mime_types=array['image/jpeg','image/png','image/webp']::text[] where id='staff-assets'$sql$;
  end if;
end
$$;

commit;
