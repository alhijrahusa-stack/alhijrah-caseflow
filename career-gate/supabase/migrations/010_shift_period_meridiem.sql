create or replace function public.cg_shift_period(p_hours text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  m text[];
  h integer;
  meridiem text;
begin
  m := regexp_match(
    coalesce(p_hours, ''),
    '([0-9]{1,2}):[0-9]{2}[[:space:]]*(ص|م|AM|PM|am|pm)?'
  );
  if m is null then
    return 'unspecified';
  end if;

  h := m[1]::integer;
  meridiem := lower(coalesce(m[2], ''));

  if meridiem in ('م', 'pm') then
    return 'evening';
  end if;
  if meridiem in ('ص', 'am') then
    return 'morning';
  end if;
  if h < 12 then
    return 'morning';
  end if;
  return 'evening';
end;
$$;

update public.client_preferences
set shift_period = public.cg_shift_period(hours),
    auto_dispatched_at = coalesce(auto_dispatched_at, now())
where shift_period is distinct from public.cg_shift_period(hours)
   or auto_dispatched_at is null;
