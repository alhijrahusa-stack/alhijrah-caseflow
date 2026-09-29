-- Preserve the final Super Admin as a database invariant.
-- Server authorization is also super-admin-only, but the database must remain
-- safe if a privileged mutation reaches it through another trusted path.

create or replace function public.protect_last_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'super_admin'
     and old.active
     and (new.role is distinct from 'super_admin' or new.active is false)
     and not exists (
       select 1
       from public.staff s
       where s.id <> old.id
         and s.role = 'super_admin'
         and s.active
     ) then
    raise exception 'last_super_admin' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_last_super_admin() from public, anon, authenticated;

drop trigger if exists staff_last_super_admin_guard on public.staff;
create trigger staff_last_super_admin_guard
before update of role, active on public.staff
for each row execute function public.protect_last_super_admin();
