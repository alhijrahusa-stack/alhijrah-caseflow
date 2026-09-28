create sequence if not exists public.career_staff_code_seq start with 7;

create or replace function public.next_staff_code()
returns text
language sql
security definer
set search_path = public
as $$
  select 'Career-' || lpad(nextval('public.career_staff_code_seq')::text, 3, '0');
$$;

alter table public.staff
  add column if not exists staff_code text,
  add column if not exists commission_type text not null default 'fixed',
  add column if not exists commission_value numeric(10,2) not null default 0,
  add column if not exists eligible_for_round_robin boolean not null default true;

alter table public.staff alter column staff_code set default public.next_staff_code();

update public.staff set staff_code='Career-001', display_name='عبدالله المريسي'
where lower(coalesce(email,''))='alhijrahusa@gmail.com';
update public.staff set staff_code='Career-002', display_name='صلاح عبدالحكيم'
where lower(display_name) in ('salah','صلاح عبدالحكيم');
update public.staff set staff_code='Career-003', display_name='يوسف عبدالحكيم'
where lower(display_name) in ('yusuf','يوسف عبدالحكيم');
update public.staff set staff_code='Career-006', display_name='أنس عبدالحكيم'
where lower(display_name) in ('anas','أنس عبدالحكيم','انس عبدالحكيم');

insert into public.staff(display_name,role,staff_code,active)
select 'فاطمه عبدالحكيم','staff','Career-004',true
where not exists(select 1 from public.staff where staff_code='Career-004');

insert into public.staff(display_name,role,staff_code,active)
select 'محمد عبدالحكيم','staff','Career-005',true
where not exists(select 1 from public.staff where staff_code='Career-005');

update public.staff set staff_code=public.next_staff_code() where staff_code is null;
create unique index if not exists staff_code_key on public.staff(staff_code);

select setval(
  'public.career_staff_code_seq',
  greatest(6,coalesce((select max(nullif(regexp_replace(staff_code,'\D','','g'),'')::bigint) from public.staff),6)),
  true
);

create table if not exists public.client_accounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.clients(id) on delete restrict,
  fee_amount numeric(10,2) not null default 150.00 check (fee_amount >= 0),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid','refunded')),
  payment_method text check (payment_method is null or payment_method in ('zelle','bank_transfer','cash','card')),
  payment_date date,
  receipt_document_id uuid references public.documents(id) on delete set null,
  assigned_staff uuid references public.staff(id),
  commission_staff_id uuid references public.staff(id),
  commission_amount numeric(10,2) not null default 0 check (commission_amount >= 0),
  paid_at timestamptz,
  updated_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (payment_status <> 'paid' or (payment_method is not null and payment_date is not null))
);

create index if not exists client_accounts_status_idx on public.client_accounts(payment_status,payment_date desc);
create index if not exists client_accounts_staff_idx on public.client_accounts(commission_staff_id,payment_date desc);

drop trigger if exists client_accounts_touch on public.client_accounts;
create trigger client_accounts_touch before update on public.client_accounts
for each row execute function public.touch_updated_at();

create or replace function public.ensure_client_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pipeline_stage in ('interview_passed','post_interview_completion') then
    insert into public.client_accounts(client_id,assigned_staff)
    values(new.id,new.assigned_staff)
    on conflict(client_id) do update set assigned_staff=excluded.assigned_staff;
  elsif new.assigned_staff is distinct from old.assigned_staff then
    update public.client_accounts
       set assigned_staff=new.assigned_staff
     where client_id=new.id and payment_status='pending';
  end if;
  return new;
end;
$$;

drop trigger if exists clients_account_sync on public.clients;
create trigger clients_account_sync
after update of pipeline_stage,assigned_staff on public.clients
for each row execute function public.ensure_client_account();

insert into public.client_accounts(client_id,assigned_staff)
select id,assigned_staff from public.clients
where deleted_at is null and pipeline_stage in ('interview_passed','post_interview_completion')
on conflict(client_id) do nothing;

create or replace function public.snapshot_payment_commission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare ct text; cv numeric(10,2);
begin
  if new.payment_status='paid' and old.payment_status is distinct from 'paid' then
    new.paid_at:=now();
    new.commission_staff_id:=coalesce(new.commission_staff_id,new.assigned_staff);
    if new.commission_staff_id is not null then
      select commission_type,commission_value into ct,cv from public.staff where id=new.commission_staff_id;
      new.commission_amount:=case when ct='percent' then round(new.fee_amount*coalesce(cv,0)/100.0,2) else coalesce(cv,0) end;
    else
      new.commission_amount:=0;
    end if;
  elsif new.payment_status<>'paid' then
    new.paid_at:=null;
  end if;
  return new;
end;
$$;

drop trigger if exists client_accounts_commission_snapshot on public.client_accounts;
create trigger client_accounts_commission_snapshot
before update of payment_status,assigned_staff,fee_amount on public.client_accounts
for each row execute function public.snapshot_payment_commission();
