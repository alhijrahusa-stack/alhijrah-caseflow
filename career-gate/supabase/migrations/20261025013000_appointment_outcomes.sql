begin;

insert into public.pipeline_stages (key,position,label_en,label_ar,color,terminal) values
('need_new_appointment',8,'Needs New Appointment','يحتاج إلى موعد جديد','#F59E0B',false),
('archive_not_interested',9,'Not Interested — Closed','غير مهتم — ملف مغلق','#64748B',true),
('payment_required',10,'Payment Required','بانتظار التحقق من الدفع','#D4AF37',false)
on conflict (key) do nothing;

create table if not exists public.appointment_outcomes (
  appointment_id uuid primary key references public.appointments(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  decision text not null check (decision in ('pass','fail','missed','cancelled_interested','cancelled_not_interested')),
  note text check (note is null or char_length(note)<=1000),
  recorded_by uuid not null references public.staff(id) on delete restrict,
  recorded_at timestamptz not null default now()
);
create index if not exists appointment_outcomes_client_idx on public.appointment_outcomes(client_id,recorded_at desc);
alter table public.appointment_outcomes enable row level security;
revoke all on public.appointment_outcomes from public,anon;
grant select,insert,update on public.appointment_outcomes to authenticated;
drop policy if exists appointment_outcomes_read on public.appointment_outcomes;
create policy appointment_outcomes_read on public.appointment_outcomes for select to authenticated
using (public.cg_can_access_client(client_id));
drop policy if exists appointment_outcomes_insert on public.appointment_outcomes;
create policy appointment_outcomes_insert on public.appointment_outcomes for insert to authenticated
with check (public.cg_can_access_client(client_id) and public.cg_staff_role() in ('admin','manager')
 and recorded_by=public.cg_staff_id() and exists
 (select 1 from public.appointments a where a.id=appointment_id and a.client_id=client_id));
drop policy if exists appointment_outcomes_update on public.appointment_outcomes;
create policy appointment_outcomes_update on public.appointment_outcomes for update to authenticated
using (public.cg_can_access_client(client_id) and public.cg_staff_role() in ('admin','manager'))
with check (public.cg_can_access_client(client_id) and public.cg_staff_role() in ('admin','manager')
 and recorded_by=public.cg_staff_id() and exists
 (select 1 from public.appointments a where a.id=appointment_id and a.client_id=client_id));
commit;
