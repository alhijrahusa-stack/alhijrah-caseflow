-- Allow one contact email to be shared by different applicants while preserving
-- duplicate protection for the same applicant and for duplicate phone identities.

create or replace function public.guard_client_identity_duplicate()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  r record;
  ek text;
  pk text;
  nk text;
  dk text;
begin
  ek:=nullif(lower(trim(coalesce(new.email,''))),'');
  pk:=nullif(regexp_replace(coalesce(new.phone,''),'\D','','g'),'');
  nk:=nullif(lower(regexp_replace(trim(coalesce(new.full_name,'')),'\s+',' ','g')),'');
  dk:=case when new.date_of_birth is null then null else new.date_of_birth::text end;

  if ek is not null then
    perform pg_advisory_xact_lock(hashtextextended('cg-email:'||ek,0));
    select c.ref,c.pipeline_stage,s.display_name owner into r
    from public.clients c
    left join public.staff s on s.id=c.assigned_staff
    where c.deleted_at is null
      and c.id is distinct from new.id
      and lower(trim(coalesce(c.email,'')))=ek
      and (
        (nk is not null and lower(regexp_replace(trim(coalesce(c.full_name,'')),'\s+',' ','g'))=nk)
        or (dk is not null and c.date_of_birth::text=dk)
        or (pk is not null and length(pk)>=7 and regexp_replace(coalesce(c.phone,''),'\D','','g')=pk)
      )
    order by c.created_at
    limit 1;
    if found then
      raise exception 'duplicate_client_identity|email|%|%|%',r.ref,r.pipeline_stage,coalesce(r.owner,'Unassigned') using errcode='P0001';
    end if;
  end if;

  if pk is not null and length(pk)>=7 then
    perform pg_advisory_xact_lock(hashtextextended('cg-phone:'||pk,0));
    select c.ref,c.pipeline_stage,s.display_name owner into r
    from public.clients c
    left join public.staff s on s.id=c.assigned_staff
    where c.deleted_at is null
      and c.id is distinct from new.id
      and regexp_replace(coalesce(c.phone,''),'\D','','g')=pk
    order by c.created_at
    limit 1;
    if found then
      raise exception 'duplicate_client_identity|phone|%|%|%',r.ref,r.pipeline_stage,coalesce(r.owner,'Unassigned') using errcode='P0001';
    end if;
  end if;

  return new;
end;
$$;
