begin;

revoke all on function public.cg_update_staff_permissions(uuid,text,text[],timestamptz,text) from public;
revoke execute on function public.cg_update_staff_permissions(uuid,text,text[],timestamptz,text) from anon;
grant execute on function public.cg_update_staff_permissions(uuid,text,text[],timestamptz,text) to authenticated;

commit;
