import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { withStaff, type StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { moveWorkflowClient } from "@/lib/manual-workflow";
import { operationalClientList } from "@/lib/operational-clients";
import { submitManagerReview, resolveManagerReview } from "@/lib/manager-inbox";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";
import { deliverWorksiteChangeEmail } from "@/lib/worksite-change-email";
import { executeWorksiteChange, getWorksiteChanges } from "@/lib/worksite-changes";
import { WORKSITE_OPTIONS, type WorksiteChangeCommand } from "@/lib/worksite-change-schema";
import type { ClientStageFilter } from "@/lib/client-lifecycle-filters";

const db=sql(),trace="worksite-change-integration";
let owner:StaffSession,outsider:StaffSession,manager:StaffSession;
let serial=8700;
async function member(role:"staff"|"manager") {
  const authUserId=randomUUID(),email=`worksite-${authUserId}@test.invalid`;
  await db`insert into auth.users(id,email) values(${authUserId},${email})`;
  const [staff]=await db`insert into staff(display_name,email,role,auth_user_id) values(${`TEST Worksite ${role} ${authUserId}`},${email},${role},${authUserId}) returning id,display_name,email,role`;
  return {authUserId,staff:staff as StaffSession['staff']};
}
async function client(consent=true,label='TEST Worksite Applicant') {
  serial++;
  return db.begin(tx=>insertClient(tx,{
    source:'staff_manual',profile:ProfileSchema.parse({full_name:`${label} ${serial}`,phone:`313555${serial}`,email:`worksite-applicant-${serial}@test.invalid`,employment_history:[]}),
    primary:[],backup:[],status:'new_intake',nextStep:null,assignedStaff:owner.staff.id,createdBy:manager.staff.id,communicationConsent:consent,
  },{staffId:manager.staff.id,traceId:trace}));
}
async function move(as:StaffSession,id:string,destination:ClientStageFilter) {
  return withStaff(as,async tx=>{
    const [row]=await tx`select id,current_status,pipeline_stage,next_step from clients where id=${id} for update`;
    if(!row)throw new Error('Client not accessible');
    return moveWorkflowClient(tx,as,row as {id:string;current_status:string;pipeline_stage:string;next_step:string},destination,'Integration workflow decision',trace);
  });
}
const version=async(id:string)=>String((await db`select updated_at::text version from clients where id=${id}`)[0].version);
const state=async(id:string)=>(await db`select id,current_status,pipeline_stage,operational_location,preferred_location,start_date,shift_days,shift_start_time,shift_end_time from clients where id=${id}`)[0];
async function confirmation(id:string,patch:Record<string,unknown>={}) {
  return {operation:'confirm',client_id:id,operation_id:randomUUID(),expected_updated_at:await version(id),
    current_site_code:WORKSITE_OPTIONS[0].code,requested_site_code:WORKSITE_OPTIONS[1].code,final_site_code:WORKSITE_OPTIONS[2].code,
    shift_days:'Wednesday – Saturday',shift_start:'18:30',shift_end:'05:00',new_start_date:'2026-11-18',confirmed_at:'2026-11-07T19:30:00Z',...patch} as WorksiteChangeCommand;
}

beforeAll(async()=>{owner=await member('staff');outsider=await member('staff');manager=await member('manager');});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
afterAll(async()=>{await db.end();});

describe('one original client through worksite change and ordinary workflow',()=>{
  it('moves one original into the new station, excludes the old list and preserves RLS scope',async()=>{
    const c=await client();
    await move(owner,c.id,'worksite_change');
    expect(await state(c.id)).toMatchObject({operational_location:'worksite_change',pipeline_stage:'worksite_change'});
    expect((await operationalClientList(owner,'active',1,20,{q:c.ref})).total).toBe(0);
    const own=await getWorksiteChanges(owner,{q:c.ref});
    expect(own.rows).toHaveLength(1);expect(own.rows[0]).toMatchObject({client_id:c.id,status:'pending'});
    const selectedId=own.rows[0].id!;
    const selectedPage=await getWorksiteChanges(owner,{q:c.ref,selectedId});
    expect(selectedPage.selected).toEqual(selectedPage.rows[0]);
    const offPage=await getWorksiteChanges(owner,{q:`unmatched-${randomUUID()}`,page:999,selectedId});
    expect(offPage).toMatchObject({rows:[],total:0,page:1,selected:{id:selectedId,client_id:c.id}});
    expect((await getWorksiteChanges(outsider,{q:c.ref})).rows).toEqual([]);
    expect((await getWorksiteChanges(outsider,{q:c.ref,selectedId})).selected).toBeNull();
    expect((await getWorksiteChanges(owner,{selectedId:randomUUID()})).selected).toBeNull();
    await expect(executeWorksiteChange(outsider,await confirmation(c.id),trace)).rejects.toMatchObject({code:'not_found'});
    expect(Number((await db`select count(*) n from clients where id=${c.id}`)[0].n)).toBe(1);
    expect(Number((await db`select count(*) n from appointment_outcomes where client_id=${c.id}`)[0].n)).toBe(0);
  });

  it('commits the chosen final worksite, selected time, canonical schedule and one immutable confirmation/outbox',async()=>{
    vi.stubEnv('RESEND_API_KEY','');vi.stubEnv('RESEND_FROM_EMAIL','');
    const c=await client();await move(owner,c.id,'worksite_change');
    const input=await confirmation(c.id);
    const result=await executeWorksiteChange(owner,input,trace);
    expect(result.row).toMatchObject({status:'confirmed',current_site_code:WORKSITE_OPTIONS[0].code,requested_site_code:WORKSITE_OPTIONS[1].code,
      final_site_code:WORKSITE_OPTIONS[2].code,shift_start:'18:30',shift_end:'05:00',new_start_date:'2026-11-18',confirmed_at:'2026-11-07T19:30:00.000Z',confirmed_by_name:owner.staff.display_name,notification_status:'not_configured',sent_at:null});
    expect(result.row?.recorded_at).not.toBe(result.row?.confirmed_at);
    expect(await state(c.id)).toMatchObject({operational_location:'worksite_change',preferred_location:WORKSITE_OPTIONS[2].name,
      shift_days:['WED','THU','FRI','SAT'],shift_start_time:'18:30:00',shift_end_time:'05:00:00'});
    const replay=await executeWorksiteChange(owner,input,trace);expect(replay).toEqual(result);
    await expect(executeWorksiteChange(manager,await confirmation(c.id),trace)).rejects.toMatchObject({code:'already_confirmed'});
    expect(Number((await db`select count(*) n from worksite_changes where client_id=${c.id}`)[0].n)).toBe(1);
    expect(Number((await db`select count(*) n from notifications where client_id=${c.id} and template='worksite_change_confirmed'`)[0].n)).toBe(1);
    await expect(withStaff(manager,async tx=>{await tx`select set_config('cg.worksite_change','write',true)`;await tx`update worksite_changes set final_site_name='forged' where client_id=${c.id}`;})).rejects.toMatchObject({code:'42501'});
    await move(owner,c.id,'completed');
    expect((await state(c.id)).operational_location).toBe('completed');
    expect((await getWorksiteChanges(owner,{q:c.ref})).rows).toHaveLength(0);
    const history=await getWorksiteChanges(owner,{q:c.ref,tab:'confirmed'});
    expect(history.rows).toHaveLength(1);expect(history.rows[0].operational_location).toBe('completed');
    const historyOffPage=await getWorksiteChanges(owner,{q:'no matching pending file',selectedId:history.rows[0].id!});
    expect(historyOffPage.rows).toEqual([]);
    expect(historyOffPage.selected).toMatchObject({id:history.rows[0].id,status:'confirmed',operational_location:'completed',confirmed_at:'2026-11-07T19:30:00.000Z'});
    expect((await operationalClientList(owner,'completed',1,20,{q:c.ref})).total).toBe(1);
    expect(Number((await db`select count(*) n from clients where id=${c.id}`)[0].n)).toBe(1);
  });

  it('honors manager custody and restores the department when a manager returns the file',async()=>{
    const c=await client();await move(owner,c.id,'worksite_change');
    const review=await submitManagerReview(owner,{kind:'client',client_id:c.id,note:'Worksite decision',request_key:randomUUID()},trace);
    expect((await state(c.id)).operational_location).toBe('manager');
    expect((await getWorksiteChanges(owner,{q:c.ref})).rows).toHaveLength(0);
    await expect(executeWorksiteChange(owner,await confirmation(c.id),trace)).rejects.toMatchObject({code:'worksite_file_not_active'});
    await resolveManagerReview(manager,{id:review.id,destination:'keep_current',action:'return',note:'Continue relocation',expected_client_version:await version(c.id),operation_id:randomUUID()},trace);
    expect((await state(c.id)).operational_location).toBe('worksite_change');
    expect((await getWorksiteChanges(owner,{q:c.ref})).rows).toHaveLength(1);
    const second=await submitManagerReview(owner,{kind:'client',client_id:c.id,note:'Reroute relocation',request_key:randomUUID()},trace);
    await resolveManagerReview(manager,{id:second.id,destination:'completed',note:'Workflow complete',expected_client_version:await version(c.id),operation_id:randomUUID()},trace);
    expect((await state(c.id)).operational_location).toBe('completed');
  });

  it('rejects stale decisions and missing consent without partially updating the original or creating a message',async()=>{
    const c=await client(false);await move(owner,c.id,'worksite_change');
    await expect(executeWorksiteChange(owner,await confirmation(c.id),trace)).rejects.toMatchObject({code:'communication_consent_required'});
    const stale=await confirmation(c.id);await db`update clients set next_step='Updated concurrently' where id=${c.id}`;
    await expect(executeWorksiteChange(owner,stale,trace)).rejects.toMatchObject({code:'client_changed'});
    expect((await db`select status from worksite_changes where client_id=${c.id}`)[0].status).toBe('pending');
    expect(Number((await db`select count(*) n from notifications where client_id=${c.id} and template='worksite_change_confirmed'`)[0].n)).toBe(0);
  });

  it('records the real successful send time once, keeps provider idempotency on retry and rejects forged extra notifications',async()=>{
    vi.stubEnv('RESEND_API_KEY','integration-only-resend-key');vi.stubEnv('RESEND_FROM_EMAIL','Career Gate <test@test.invalid>');
    const fetchMock=vi.fn<typeof fetch>().mockImplementation(async()=>new Response(JSON.stringify({id:'integration-provider-message'}),{status:200,headers:{'Content-Type':'application/json'}}));
    vi.stubGlobal('fetch',fetchMock);
    const c=await client();await move(owner,c.id,'worksite_change');
    const result=await executeWorksiteChange(manager,await confirmation(c.id),trace);
    const notificationId=result.row!.notification_id!;
    const [initial]=await db`select payload,idempotency_key from notifications where id=${notificationId}`;
    // An owned client and ordinary notification table grants do not authorize
    // fabricating the first receipt, even inside an otherwise verified command.
    for(const commandFlag of [false,true]) {
      await expect(withStaff(owner,async tx=>{
        if(commandFlag)await tx`select set_config('cg.worksite_change','write',true)`;
        await tx`insert into notifications(client_id,channel,template,payload,status,idempotency_key,provider,provider_id,sent_at)
          values(${c.id},'email','worksite_change_confirmed',${tx.json(initial.payload)},'sent',${`fake-first-receipt:${randomUUID()}`},'resend','forged-provider-id',now())`;
      })).rejects.toMatchObject({code:'42501'});
      await expect(withStaff(owner,async tx=>{
        if(commandFlag)await tx`select set_config('cg.worksite_change','write',true)`;
        await tx`update notifications set status='sent',provider='resend',provider_id='forged-provider-id',sent_at=now(),attempts=1 where id=${notificationId}`;
      })).rejects.toMatchObject({code:'42501'});
    }
    expect((await db`select status,sent_at,provider_id,attempts from notifications where id=${notificationId}`)[0])
      .toMatchObject({status:'queued',sent_at:null,provider_id:null,attempts:0});
    expect(fetchMock).not.toHaveBeenCalled();
    // The legitimate retry repairs payload from the immutable decision and is
    // allowed to requeue; only the mocked provider worker records the receipt.
    await db`update notifications set status='failed',error='Retryable provider failure',
      payload=${db.json({...initial.payload,recipient:'forged-recipient@test.invalid'})} where id=${notificationId}`;
    const queued=await executeWorksiteChange(owner,{operation:'retry_email',client_id:c.id,change_id:result.row!.id!,operation_id:randomUUID(),expected_updated_at:await version(c.id)},trace);
    expect(queued.changed).toBe(true);
    const [notification]=await db`select payload,idempotency_key from notifications where id=${notificationId}`;
    expect(notification.idempotency_key).toBe(initial.idempotency_key);
    expect(notification.payload.recipient).toBe(result.row!.email);
    const before=Date.now();
    expect(await deliverWorksiteChangeEmail(notificationId,notification.payload)).toMatchObject({status:'sent'});
    const [delivered]=await db`select status,sent_at from notifications where id=${notificationId}`;
    expect(delivered.status).toBe('sent');expect(new Date(delivered.sent_at).getTime()).toBeGreaterThanOrEqual(before-1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(db`update notifications set sent_at=null,status='queued' where id=${notificationId}`).rejects.toMatchObject({code:'42501'});
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Idempotency-Key')).toBe(notification.idempotency_key);
    expect(await deliverWorksiteChangeEmail(notificationId,notification.payload)).toMatchObject({status:'skipped'});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const retry=await executeWorksiteChange(owner,{operation:'retry_email',client_id:c.id,change_id:result.row!.id!,operation_id:randomUUID(),expected_updated_at:await version(c.id)},trace);
    expect(retry.changed).toBe(false);expect(fetchMock).toHaveBeenCalledTimes(1);
    const [forged]=await db`insert into notifications(client_id,channel,template,payload,status,idempotency_key)
      values(${c.id},'email','worksite_change_confirmed',${db.json(notification.payload)},'queued',${`forged:${randomUUID()}`}) returning id`;
    expect(await deliverWorksiteChangeEmail(String(forged.id),notification.payload)).toMatchObject({status:'failed',retryable:false});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clamps filtered pages and returns an off-page selection without changing the page or leaking another employee’s record',async()=>{
    const label=`TEST Worksite Page ${randomUUID().slice(0,8)}`;
    for(let index=0;index<21;index++){const c=await client(true,label);await move(owner,c.id,'worksite_change');}
    const first=await getWorksiteChanges(owner,{q:label,page:1});
    expect(first.rows).toHaveLength(20);expect(first.total).toBe(21);expect(first.page).toBe(1);
    const selectedId=first.rows[0].id!;
    const last=await getWorksiteChanges(owner,{q:label,page:999,selectedId});
    expect(last.rows).toHaveLength(1);expect(last.total).toBe(21);expect(last.page).toBe(2);
    expect(last.rows.some(row=>row.id===selectedId)).toBe(false);
    expect(last.selected).toEqual(first.rows[0]);
    expect((await getWorksiteChanges(owner,{q:`${label}%`})).total).toBe(0);
    const denied=await getWorksiteChanges(outsider,{q:label,page:999,selectedId});
    expect(denied).toMatchObject({rows:[],total:0,page:1,selected:null});
  });
});
