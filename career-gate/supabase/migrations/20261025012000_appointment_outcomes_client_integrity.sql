begin;

-- A decision must belong to the same client as its appointment.
-- The original separate foreign keys permit cross-client mismatches.
alter table public.appointments
  add constraint appointments_id_client_key unique (id, client_id);

alter table public.appointment_outcomes
  add constraint appointment_outcomes_appointment_client_fkey
  foreign key (appointment_id, client_id)
  references public.appointments (id, client_id)
  on delete restrict;

-- Correlate against the OUTER row explicitly. The previous unqualified
-- "client_id" was resolved to appointments.client_id on both sides.
-- Enforce the interview type and the persisted appointment decision state
-- for direct authenticated Data API writes, not only server-side actions.
drop policy if exists appointment_outcomes_insert on public.appointment_outcomes;
create policy appointment_outcomes_insert
  on public.appointment_outcomes for insert to authenticated
  with check (
    public.cg_can_access_client(appointment_outcomes.client_id)
    and public.cg_staff_role() in ('admin', 'manager')
    and appointment_outcomes.recorded_by = public.cg_staff_id()
    and exists (
      select 1 from public.appointments a
      where a.id = appointment_outcomes.appointment_id
        and a.client_id = appointment_outcomes.client_id
        and a.appointment_kind = 'employment_interview'
        and (
          (appointment_outcomes.decision in ('pass', 'fail') and a.status = 'attended')
          or (appointment_outcomes.decision = 'missed' and a.status = 'missed')
          or (appointment_outcomes.decision in ('cancelled_interested', 'cancelled_not_interested') and a.status = 'cancelled')
        )
    )
  );

commit;
