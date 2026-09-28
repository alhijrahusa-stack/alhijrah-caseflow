do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='staff_commission_type_check' and conrelid='public.staff'::regclass
  ) then
    alter table public.staff add constraint staff_commission_type_check
      check (commission_type in ('fixed','percent'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname='staff_commission_value_check' and conrelid='public.staff'::regclass
  ) then
    alter table public.staff add constraint staff_commission_value_check
      check (commission_value >= 0);
  end if;
end $$;
