import "server-only";
import { withStaff, type StaffSession } from "@/lib/auth";

export type SearchResult={kind:"client"|"document"|"task"|"appointment"|"payment"|"staff";id:string;primary:string;secondary:string;meta:string|null;href:string};
const s=(v:unknown)=>String(v);const ns=(v:unknown)=>v==null?null:String(v);

export async function unifiedSearch(session:StaffSession,query:string):Promise<SearchResult[]>{
  const term=query.trim();
  if(term.length<2)return[];
  const like=`%${term.replace(/[%_]/g,"\\$&")}%`;
  return withStaff(session,async(tx)=>{
    const rows=await tx`
      with results as (
        select 'client'::text kind,c.id::text id,c.full_name primary_text,
               c.ref||' · '||c.phone secondary_text,c.current_status meta,'/staff/client/'||c.id::text href,1 priority
          from clients c
         where c.deleted_at is null and (c.ref ilike ${like} escape '\\' or c.full_name ilike ${like} escape '\\' or c.phone ilike ${like} escape '\\' or coalesce(c.email,'') ilike ${like} escape '\\')
        union all
        select 'document',d.id::text,c.full_name,d.file_name||' · '||replace(d.doc_type,'_',' '),d.status,'/staff/client/'||d.client_id::text||'?tab=documents',2
          from documents d join clients c on c.id=d.client_id and c.deleted_at is null
         where d.file_name ilike ${like} escape '\\' or d.doc_type ilike ${like} escape '\\' or c.ref ilike ${like} escape '\\'
        union all
        select 'task',t.id::text,t.title,c.full_name||' · '||c.ref,t.status,'/staff/client/'||t.client_id::text||'?tab=work',3
          from tasks t join clients c on c.id=t.client_id and c.deleted_at is null
         where t.title ilike ${like} escape '\\' or coalesce(t.description,'') ilike ${like} escape '\\' or c.ref ilike ${like} escape '\\' or c.full_name ilike ${like} escape '\\'
        union all
        select 'appointment',a.id::text,c.full_name,replace(a.appointment_type,'_',' ')||' · '||c.ref,a.status,'/staff/client/'||a.client_id::text||'?tab=appointments',4
          from appointments a join clients c on c.id=a.client_id and c.deleted_at is null
         where a.appointment_type ilike ${like} escape '\\' or coalesce(a.location,'') ilike ${like} escape '\\' or c.ref ilike ${like} escape '\\' or c.full_name ilike ${like} escape '\\'
        union all
        select 'payment',t.id::text,c.full_name,c.ref||' · '||t.transaction_type,coalesce(t.transaction_reference,t.payment_method,'—'),'/staff/accounting',5
          from account_transactions t join clients c on c.id=t.client_id and c.deleted_at is null
         where coalesce(t.transaction_reference,'') ilike ${like} escape '\\' or c.ref ilike ${like} escape '\\' or c.full_name ilike ${like} escape '\\'
        union all
        select 'staff',s.id::text,s.display_name,coalesce(s.staff_code,'—')||' · '||coalesce(s.email,'—'),s.role,'/staff/admin',6
          from staff s
         where s.display_name ilike ${like} escape '\\' or coalesce(s.staff_code,'') ilike ${like} escape '\\' or coalesce(s.email,'') ilike ${like} escape '\\' or coalesce(s.phone,'') ilike ${like} escape '\\'
      )
      select * from results order by priority,primary_text limit 100`;
    return rows.map(r=>({kind:s(r.kind) as SearchResult["kind"],id:s(r.id),primary:s(r.primary_text),secondary:s(r.secondary_text),meta:ns(r.meta),href:s(r.href)}));
  });
}
