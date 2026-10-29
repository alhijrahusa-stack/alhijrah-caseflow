import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appointmentEmailIdempotencyKey, queueAdvanceAppointmentReminders, queueAppointmentEmails } from "@/lib/appointment-email";
import { sql } from "@/lib/db";
import { processJobs } from "@/lib/jobs";
import { deliverNotification } from "@/lib/notify";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";

const db = sql();
let phone = 5000;

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "isolated-integration-key");
  vi.stubEnv("RESEND_FROM_EMAIL", "notifications@test.invalid");
  vi.stubEnv("CAREER_GATE_ADMIN_EMAIL", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

afterAll(async () => { await db.end(); });

async function appointment(hours = 336) {
  phone++;
  const clientName=`Notification Recovery Test ${phone}`;
  const client = await db.begin(tx => insertClient(tx, {
    source:"staff_manual",
    profile:ProfileSchema.parse({full_name:clientName,phone:`313555${phone}`,email:"client@test.invalid",date_of_birth:"1990-04-05",employment_history:[]}),
    primary:[],backup:[],status:"new_intake",nextStep:null,assignedStaff:null,createdBy:null,communicationConsent:true,
  }, {staffId:null,traceId:"notification-recovery-test"}));
  const start = new Date(Date.now()+hours*3_600_000);
  const [row] = await db`insert into appointments(client_id,appointment_type,scheduled_at,ends_at,resource_key,location,status)
    values(${client.id},'Employment interview',${start},${new Date(start.getTime()+1_800_000)},'office','Test warehouse','confirmed')
    returning id,client_id,scheduled_at,location,appointment_type,resource_key`;
  return {
    id:String(row.id),client_id:String(row.client_id),clientName,scheduled_at:new Date(row.scheduled_at),
    location:String(row.location),appointment_type:String(row.appointment_type),resource_key:String(row.resource_key),
  };
}

async function queueConfirmation(hours = 336) {
  const appt = await appointment(hours);
  await db.begin(tx => queueAppointmentEmails(tx,appt,"scheduled","notification-recovery-test"));
  const [notification] = await db`select id,payload,idempotency_key from notifications
    where payload->>'appointmentId'=${appt.id} and template='appointment_scheduled'`;
  expect(notification).toBeDefined();
  return {appt,id:String(notification.id),payload:notification.payload as Record<string,unknown>,key:String(notification.idempotency_key)};
}

describe("appointment notification recovery on isolated PostgreSQL", () => {
  it("retries transient failures with one queue row and one stable provider key", async () => {
    const {id,key} = await queueConfirmation();
    const transport = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({message:"temporary provider failure"}),{status:503}))
      .mockResolvedValueOnce(new Response(JSON.stringify({id:"em_recovered"}),{status:200}));
    vi.stubGlobal("fetch",transport);
    await processJobs(50);
    let [row] = await db`select status,attempts,provider_id,error,sent_at,updated_at from notifications where id=${id}`;
    expect(row).toMatchObject({status:"queued",attempts:1,provider_id:null,sent_at:null,error:"temporary provider failure"});
    expect(row.updated_at).toBeInstanceOf(Date);
    await db`update jobs set run_after=now() where entity_id=${id} and type='notification_send'`;
    await processJobs(50);
    [row] = await db`select status,attempts,provider_id,error,sent_at from notifications where id=${id}`;
    expect(row).toMatchObject({status:"sent",attempts:2,provider_id:"em_recovered",error:null});
    expect(row.sent_at).toBeInstanceOf(Date);
    expect(transport).toHaveBeenCalledTimes(2);
    for (const call of transport.mock.calls) {
      const [url,init] = call as [string,RequestInit];
      expect(url).toBe("https://api.resend.com/emails");
      expect(new Headers(init.headers).get("Idempotency-Key")).toBe(key);
      expect(JSON.parse(String(init.body)).to).toEqual(["client@test.invalid"]);
    }
    expect((await db`select count(*)::int n from jobs where entity_id=${id}`)[0].n).toBe(1);
    expect(await deliverNotification(id)).toEqual({status:"skipped"});
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("does not acknowledge a job as sent while another worker holds its delivery lease", async () => {
    const {id} = await queueConfirmation();
    let started:()=>void = ()=>{};
    let release:()=>void = ()=>{};
    const entered = new Promise<void>(resolve=>{started=resolve;});
    const gate = new Promise<void>(resolve=>{release=resolve;});
    const transport = vi.fn(async ()=>{
      started();
      await gate;
      return new Response(JSON.stringify({id:"em_one_delivery"}),{status:200});
    });
    vi.stubGlobal("fetch",transport);
    const first = deliverNotification(id);
    try {
      await entered;
      expect(await deliverNotification(id)).toEqual({status:"busy"});
      expect(transport).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
    expect(await first).toMatchObject({status:"sent",provider_id:"em_one_delivery"});
    expect((await db`select attempts from notifications where id=${id}`)[0].attempts).toBe(1);
  });

  it("recovers a crashed worker with the original provider key after its lease expires", async () => {
    const appt = await appointment();
    const payload = {
      appointmentId:appt.id,scheduledAt:appt.scheduled_at.toISOString(),location:appt.location,
      recipient:"client@test.invalid",clientName:appt.clientName,appointmentType:appt.appointment_type,
      event:"scheduled" as const,recipientKind:"client" as const,
    };
    const key = appointmentEmailIdempotencyKey(payload);
    const [row] = await db`insert into notifications(client_id,channel,template,payload,status,attempts,updated_at,idempotency_key)
      values(${appt.client_id},'email','appointment_scheduled',${db.json({...payload,_firstDeliveryAttemptAt:new Date(Date.now()-180_000).toISOString()})},
        'sending',1,now()-interval '3 minutes',${key}) returning id`;
    const transport=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:"em_original_acceptance"}),{status:200}));
    vi.stubGlobal("fetch",transport);
    expect(await deliverNotification(String(row.id))).toMatchObject({status:"sent",provider_id:"em_original_acceptance"});
    expect(new Headers((transport.mock.calls[0] as [string,RequestInit])[1].headers).get("Idempotency-Key")).toBe(key);
    expect((await db`select status,attempts from notifications where id=${row.id}`)[0]).toMatchObject({status:"sent",attempts:2});
  });

  it.each([null,new Date(Date.now()-25*3_600_000).toISOString()])("requires reconciliation when an earlier provider acceptance cannot safely be retried (%s)", async firstAttempt => {
    const appt = await appointment();
    const payload = {
      appointmentId:appt.id,scheduledAt:appt.scheduled_at.toISOString(),location:appt.location,
      recipient:"client@test.invalid",clientName:appt.clientName,appointmentType:appt.appointment_type,
      event:"scheduled" as const,recipientKind:"client" as const,
      ...(firstAttempt ? {_firstDeliveryAttemptAt:firstAttempt} : {}),
    };
    const [row] = await db`insert into notifications(client_id,channel,template,payload,status,attempts,updated_at,idempotency_key)
      values(${appt.client_id},'email','appointment_scheduled',${db.json(payload)},'sending',1,now()-interval '3 minutes',${appointmentEmailIdempotencyKey(payload)}) returning id`;
    const transport=vi.fn();
    vi.stubGlobal("fetch",transport);
    expect(await deliverNotification(String(row.id))).toMatchObject({status:"failed",retryable:false});
    expect(transport).not.toHaveBeenCalled();
    expect((await db`select status,provider_id from notifications where id=${row.id}`)[0]).toMatchObject({status:"failed",provider_id:null});
  });

  it("queues reminders at confirmation for exactly 24 hours before the appointment without early sending", async () => {
    const {appt,id} = await queueConfirmation(36);
    await db.begin(tx => queueAppointmentEmails(tx,appt,"scheduled","notification-recovery-test"));
    const rows=await db`select n.id,n.template,j.run_after,j.status from notifications n join jobs j on j.entity_id=n.id::text
      where n.payload->>'appointmentId'=${appt.id}`;
    expect(rows).toHaveLength(2);
    const reminder=rows.find(row=>row.template==='appointment_reminder');
    expect(reminder).toBeDefined();
    expect(new Date(reminder!.run_after).getTime()).toBe(appt.scheduled_at.getTime()-24*3_600_000);
    const transport=vi.fn().mockResolvedValue(new Response(JSON.stringify({id:"em_confirmation_only"}),{status:200}));
    vi.stubGlobal("fetch",transport);
    await processJobs(50);
    expect((await db`select status from notifications where id=${id}`)[0].status).toBe("sent");
    expect((await db`select status from notifications where id=${reminder!.id}`)[0].status).toBe("queued");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await queueAdvanceAppointmentReminders()).toBe(0);
  });
});
