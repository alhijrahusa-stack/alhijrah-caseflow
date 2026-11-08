import "server-only";
import type { StaffSession, Tx } from "@/lib/auth";
import { withStaff } from "@/lib/auth";
import { ActionError } from "@/lib/service";
import { staffOperation } from "@/lib/staff-operation";
import { enqueue } from "@/lib/jobs";
import { providerStates } from "@/lib/providers/config";
import { queueWorksiteChangeEmail } from "@/lib/worksite-change-email";
import { findWorksite, parseWorksiteDays, WORKSITE_TIMEZONE, type WorksiteChangeCommand, type WorksiteChangeData, type WorksiteChangeRow } from "@/lib/worksite-change-schema";

/** Called only after the locked original has entered its exclusive station. */
export async function ensurePendingWorksiteChange(tx: Tx, session: StaffSession, clientId: string) {
  const [pending] = await tx`select id from worksite_changes where client_id=${clientId} and status='pending'`;
  if (pending) return String(pending.id);
  const [primary] = await tx`select site_code,site_name,site_address from client_preferences
    where client_id=${clientId} and rank='primary' order by preference_order,id limit 1`;
  const [prior] = await tx`select current_setting('cg.worksite_change',true) value`;
  await tx`select set_config('cg.worksite_change','write',true)`;
  const [created] = await tx`insert into worksite_changes(client_id,current_site_code,current_site_name,current_site_address,created_by)
    values(${clientId},${primary?.site_code ?? null},${primary?.site_name ?? null},${primary?.site_address ?? null},${session.staff.id}) returning id`;
  await tx`select set_config('cg.worksite_change',${prior.value ?? ""},true)`;
  return String(created.id);
}

function fields(tx: Tx) {
  return tx`w.id,c.id client_id,c.ref,c.full_name,c.email,
    w.current_site_code,w.current_site_name,w.current_site_address,
    w.requested_site_code,w.requested_site_name,w.requested_site_address,
    w.final_site_code,w.final_site_name,w.final_site_address,
    coalesce(w.status,'pending') status,w.shift_days,to_char(w.shift_start,'HH24:MI') shift_start,
    to_char(w.shift_end,'HH24:MI') shift_end,w.new_start_date::text new_start_date,
    w.confirmed_at,w.recorded_at,w.confirmed_by_name,w.notification_id,n.status notification_status,n.payload->>'recipient' notification_recipient,
    n.sent_at,n.error notification_error,c.operational_location,c.current_status,c.updated_at::text client_version`;
}
function rowDTO(row: Record<string, unknown>): WorksiteChangeRow {
  const date = (value: unknown) => value instanceof Date ? value.toISOString() : value == null ? null : new Date(String(value)).toISOString();
  return { ...row, confirmed_at: date(row.confirmed_at), recorded_at: date(row.recorded_at), sent_at: date(row.sent_at) } as WorksiteChangeRow;
}
export async function worksiteChangeRow(tx: Tx, id: string) {
  const [row] = await tx`select ${fields(tx)} from worksite_changes w join clients c on c.id=w.client_id
    left join notifications n on n.id=w.notification_id where w.id=${id} and c.deleted_at is null`;
  return row ? rowDTO(row) : null;
}

export async function getWorksiteChanges(session: StaffSession, input: {tab?: "pending" | "confirmed";q?: string;page?: number;selectedId?: string} = {}): Promise<WorksiteChangeData> {
  return withStaff(session, async tx => {
    const tab = input.tab === "confirmed" ? "confirmed" : "pending";
    const q = input.q?.trim().slice(0, 100) ?? "";
    const like = `%${q.replace(/[\\%_]/g, value => `\\${value}`)}%`;
    const search = q ? tx`(c.ref ilike ${like} or c.full_name ilike ${like} or c.phone ilike ${like} or c.email ilike ${like})` : tx`true`;
    const base = tab === "confirmed"
      ? tx`from worksite_changes w join clients c on c.id=w.client_id
          where c.deleted_at is null and w.status='confirmed' and ${search}`
      : tx`from clients c left join lateral(select * from worksite_changes change where change.client_id=c.id order by change.created_at desc,change.id desc limit 1) w on true
          where c.deleted_at is null and c.operational_location='worksite_change' and coalesce(w.status,'pending')='pending' and ${search}`;
    const pageSize = 20;
    const requestedPage = Math.max(1, Math.trunc(Number.isFinite(input.page) ? input.page! : 1) || 1);
    const selectedId = input.selectedId ?? null;
    // Only narrow IDs are materialized for pagination. Full row/notification
    // joins run for the displayed page and, if necessary, its selected detail.
    // All counts and records are read from the same RLS-scoped SQL snapshot.
    const [result] = await tx`with filtered as materialized (
        select w.id,c.id client_id,coalesce(w.recorded_at,w.created_at,c.updated_at) sort_at ${base}
      ), tally as (select count(*)::int total from filtered), pagination as (
        select total,least(${requestedPage},greatest(1,ceil(total::numeric/${pageSize})::int)) page from tally
      ), page_ids as materialized (
        select * from filtered order by sort_at desc,client_id
        limit ${pageSize} offset (select (page-1)*${pageSize} from pagination)
      ), page_rows as materialized (
        select ${fields(tx)},p.sort_at from page_ids p join clients c on c.id=p.client_id
        left join worksite_changes w on w.id=p.id left join notifications n on n.id=w.notification_id
      ), selected as (
        select to_jsonb(p)-'sort_at' value from page_rows p where p.id=${selectedId}::uuid
        union all
        select to_jsonb(detail) value from (
          select ${fields(tx)} from worksite_changes w join clients c on c.id=w.client_id
          left join notifications n on n.id=w.notification_id
          where ${selectedId}::uuid is not null and w.id=${selectedId}::uuid and c.deleted_at is null
            and not exists(select 1 from page_ids p where p.id=${selectedId}::uuid)
        ) detail
      ) select pagination.total,pagination.page,
        (select count(*)::int from clients c where c.deleted_at is null and c.operational_location='worksite_change'
          and coalesce((select w.status from worksite_changes w where w.client_id=c.id order by w.created_at desc,w.id desc limit 1),'pending')='pending') pending,
        (select count(*)::int from worksite_changes w join clients c on c.id=w.client_id where c.deleted_at is null and w.status='confirmed') confirmed,
        coalesce((select jsonb_agg(to_jsonb(p)-'sort_at' order by p.sort_at desc,p.client_id) from page_rows p),'[]'::jsonb) rows,
        (select value from selected limit 1) selected
      from pagination`;
    return {rows: (result.rows as Record<string,unknown>[]).map(rowDTO), selected: result.selected ? rowDTO(result.selected) : null,
      counts: {pending: Number(result.pending), confirmed: Number(result.confirmed)}, total: Number(result.total), page: Number(result.page), page_size: pageSize};
  });
}

/** The caller's RLS transaction, original-client lock, command key, confirmation
 * and email outbox are one commit. No email or network request occurs in it. */
export async function executeWorksiteChange(session: StaffSession, input: WorksiteChangeCommand, traceId: string) {
  return withStaff(session, tx => staffOperation(tx,session,input.operation_id,'worksite_change',input,async () => {
    const [client] = await tx`select id,ref,full_name,email,communication_consent,preferred_location,start_date,shift_days,shift_start_time,shift_end_time,
      manager_review_id,operational_location,updated_at::text client_version from clients
      where id=${input.client_id} and deleted_at is null for update`;
    if (!client) throw new ActionError('not_found','Client unavailable or not assigned to you',404);
    if (String(client.client_version) !== input.expected_updated_at) throw new ActionError('client_changed','This file changed. Refresh before saving.',409);

    if (input.operation === 'retry_email') {
      const [record] = await tx`select *,to_char(shift_start,'HH24:MI') shift_start,to_char(shift_end,'HH24:MI') shift_end,new_start_date::text new_start_date
        from worksite_changes where id=${input.change_id} and client_id=${input.client_id} and status='confirmed'`;
      if (!record?.notification_id) throw new ActionError('not_found','Confirmed notification unavailable',404);
      const [notification] = await tx`select id,status,payload,sent_at from notifications where id=${record.notification_id} and client_id=${input.client_id} for update`;
      if (!notification) throw new ActionError('not_found','Notification unavailable',404);
      if (notification.sent_at || notification.status === 'sent' || notification.status === 'queued' || notification.status === 'sending') return {changed:false,row:await worksiteChangeRow(tx,String(record.id))};
      requireRecipient(client);
      const configured = providerStates().email_resend === 'CONFIGURED';
      const payload={changeId:String(record.id),clientName:String(client.full_name),clientRef:String(client.ref),recipient:String(client.email),
        currentSiteName:String(record.current_site_name),finalSiteName:String(record.final_site_name),finalSiteAddress:String(record.final_site_address),
        shiftDays:String(record.shift_days),shiftStart:String(record.shift_start),shiftEnd:String(record.shift_end),newStartDate:String(record.new_start_date),
        confirmedAt:new Date(record.confirmed_at).toISOString(),timezone:WORKSITE_TIMEZONE};
      await tx`select set_config('cg.worksite_change','write',true)`;
      await tx`update notifications set status=${configured ? 'queued' : 'not_configured'},error=null,
        payload=${tx.json(payload)} where id=${notification.id}`;
      if (configured) await enqueue(tx,{type:'notification_send',entityId:String(notification.id),dedupeKey:`notify:${notification.id}:retry:${input.operation_id}`,traceId});
      await activity(tx,session,input.client_id,'worksite_email_retry',{change_id:record.id,notification_id:notification.id},traceId);
      return {changed:true,row:await worksiteChangeRow(tx,String(record.id))};
    }

    if (client.manager_review_id || client.operational_location !== 'worksite_change') throw new ActionError('worksite_file_not_active','Move the file into Worksite Changes before editing it.',409);
    // Keep this as a fresh statement after the awaited client lock. A joined
    // subquery's pre-lock snapshot could otherwise retain stale history.
    const [latest] = await tx`select id,status from worksite_changes where client_id=${input.client_id} order by created_at desc,id desc limit 1`;
    if(latest?.status==='confirmed') throw new ActionError('already_confirmed','This worksite change is already confirmed. Use Workflow to continue the file.',409);
    const id = latest ? String(latest.id) : await ensurePendingWorksiteChange(tx,session,input.client_id);
    const current = findWorksite(input.current_site_code)!;
    const requested = findWorksite(input.requested_site_code)!;
    await tx`select set_config('cg.worksite_change','write',true)`;
    if (input.operation === 'save_request') {
      await tx`update worksite_changes set current_site_code=${current.code},current_site_name=${current.name},current_site_address=${current.address},
        requested_site_code=${requested.code},requested_site_name=${requested.name},requested_site_address=${requested.address} where id=${id}`;
      await tx`update clients set updated_at=now() where id=${input.client_id}`;
      await activity(tx,session,input.client_id,'worksite_change_requested',{change_id:id,current_site:current,requested_site:requested},traceId);
      return {changed:true,row:await worksiteChangeRow(tx,id)};
    }

    requireRecipient(client);
    const final = findWorksite(input.final_site_code)!;
    if (!final.address?.trim()) throw new ActionError('site_address_required','The final worksite needs a complete address in the location directory.',409);
    const queued = await queueWorksiteChangeEmail(tx,input.client_id,{
      changeId:id,clientName:String(client.full_name),clientRef:String(client.ref),recipient:String(client.email),
      currentSiteName:current.name,finalSiteName:final.name,finalSiteAddress:final.address,
      shiftDays:input.shift_days,shiftStart:input.shift_start,shiftEnd:input.shift_end,newStartDate:input.new_start_date,
      confirmedAt:input.confirmed_at,timezone:WORKSITE_TIMEZONE,
    },traceId);
    await tx`update worksite_changes set current_site_code=${current.code},current_site_name=${current.name},current_site_address=${current.address},
      requested_site_code=${requested.code},requested_site_name=${requested.name},requested_site_address=${requested.address},
      final_site_code=${final.code},final_site_name=${final.name},final_site_address=${final.address},
      shift_days=${input.shift_days},shift_start=${input.shift_start},shift_end=${input.shift_end},new_start_date=${input.new_start_date},
      confirmed_at=${input.confirmed_at},notification_id=${queued.id},status='confirmed' where id=${id}`;
    // The new employment details travel with the original file. They are marked
    // as staff-confirmed information, never as a verified live Amazon opening.
    const [primary] = await tx`select * from client_preferences where client_id=${input.client_id} and rank='primary' order by preference_order,id limit 1 for update`;
    const city = final.name.split(' (')[0];
    const hours = `${input.shift_start} – ${input.shift_end}`;
    if (primary) {
      await tx`update client_preferences set site_code=${final.code},site_name=${final.name},site_address=${final.address},city=${city},
        job_id=${`WORKSITE_CHANGE:${id}`},job_title='Confirmed worksite change',shift_code='CONFIRMED',shift_name='Confirmed work schedule',
        days=${input.shift_days},hours=${hours},catalog_source='staff_worksite_change',catalog_verified_at=null where id=${primary.id}`;
    } else {
      await tx`insert into client_preferences(client_id,rank,preference_order,site_code,site_name,site_address,city,job_id,job_title,shift_code,shift_name,days,hours,catalog_source)
        values(${input.client_id},'primary',1,${final.code},${final.name},${final.address},${city},${`WORKSITE_CHANGE:${id}`},'Confirmed worksite change','CONFIRMED','Confirmed work schedule',${input.shift_days},${hours},'staff_worksite_change')`;
    }
    await tx`update clients set preferred_location=${final.name},start_date=${input.new_start_date},shift_days=${parseWorksiteDays(input.shift_days)!},
      shift_start_time=${input.shift_start},shift_end_time=${input.shift_end},updated_at=now() where id=${input.client_id}`;
    await activity(tx,session,input.client_id,'worksite_change_confirmed',{
      change_id:id,current_site:current,requested_site:requested,final_site:final,shift_days:input.shift_days,
      shift_start:input.shift_start,shift_end:input.shift_end,new_start_date:input.new_start_date,confirmed_at:input.confirmed_at,
      previous_primary:primary ?? null,previous_start_date:client.start_date,
      previous_shift_days:client.shift_days,previous_shift_start:client.shift_start_time,previous_shift_end:client.shift_end_time,notification_id:queued.id,
    },traceId);
    return {changed:true,row:await worksiteChangeRow(tx,id)};
  }));
}

function requireRecipient(client: Record<string, unknown>) {
  if (typeof client.email !== 'string' || !client.email.trim()) throw new ActionError('client_email_required','Add the client’s email to their profile before confirming and notifying.',409);
  if (!client.communication_consent) throw new ActionError('communication_consent_required','The client’s communication consent is required before sending this email.',409);
}
async function activity(tx:Tx,session:StaffSession,clientId:string,operation:string,details:Record<string, unknown>,traceId:string) {
  await tx`insert into activity_log(client_id,action,staff_id,entity_type,entity_id,new_value,trace_id)
    values(${clientId},'client_updated',${session.staff.id},'worksite_change',${String(details.change_id ?? clientId)},${tx.json({operation,...details} as never)},${traceId})`;
}
