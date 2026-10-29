import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { ActionSchema, runAction } from "@/lib/actions";
import { withStaff, type StaffSession } from "@/lib/auth";
import { queueAppointmentNotifications } from "@/lib/appointment-notifications";
import { deliverNotification } from "@/lib/notify";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 7 });
let manager: StaffSession;
let originalKey: string | undefined;
let originalFrom: string | undefined;
const clients: string[] = [];

async function makeClient(index: number, consent = false): Promise<string> {
  const email = `appointment-sites-${index}@test.invalid`;
  const created = await db.begin(tx => insertClient(tx,{
    source: "staff_manual",
    profile: ProfileSchema.parse({full_name:`TEST Booking Site ${index}`,phone:`313555${String(7600+index)}`,email,employment_history:[]}),
    primary:[],backup:[],status:"new_intake",nextStep:null,assignedStaff:manager.staff.id,
    createdBy:manager.staff.id,communicationConsent:consent,
  },{staffId:manager.staff.id,traceId:"sites-integration"}));
  clients.push(created.id);
  return created.id;
}

const act = (payload: Record<string, unknown>) => withStaff(manager,tx=>runAction({
  tx,actor:{staffId:manager.staff.id,traceId:"sites-integration"},
  role:manager.staff.role,semantic:[],
},ActionSchema.parse(payload)));

function at(days:number,hour=0) {
  return new Date(Date.now()+days*86400000+hour*3600000).toISOString();
}

beforeAll(async()=>{
  originalKey=process.env.RESEND_API_KEY;
  originalFrom=process.env.RESEND_FROM_EMAIL;
  process.env.RESEND_API_KEY="test-credential-no-network-allowed";
  process.env.RESEND_FROM_EMAIL="test@career-gate.invalid";
  const authId=randomUUID(),email=`test-appointment-sites-${authId}@test.invalid`;
  await db`insert into auth.users(id,email) values(${authId},${email})`;
  const [staff]=await db`insert into staff(display_name,email,role,auth_user_id)
    values('TEST Booking Manager',${email},'manager',${authId}) returning id,display_name,email,role`;
  manager={authUserId:authId,staff:staff as StaffSession["staff"]};
});

afterAll(async()=>{
  if (clients.length) {
    await db`delete from notifications where client_id=any(${clients})`;
    await db`delete from appointments where client_id=any(${clients})`;
  }
  const [count]=await db`select count(*)::int total from appointments where client_id=any(${clients})`;
  expect(count.total).toBe(0);
  if(originalKey === undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=originalKey;
  if(originalFrom === undefined)delete process.env.RESEND_FROM_EMAIL;else process.env.RESEND_FROM_EMAIL=originalFrom;
  await db.end();
});

describe("Career Gate appointment booking concurrency and site referential integrity",()=>{
  it("applies all eleven locations through staging UPSERT without duplicate codes",async()=>{
    const sites=await db`select id,code,display_city,street_address from appointment_locations where active order by code`;
    expect(sites).toHaveLength(11);
    expect(sites.map(item=>item.code).sort()).toEqual(["DTW1","DET6","DET1","DET3","DDT9","SMI1","DTW3","DTW9","DGR3","DET2","DTW8"].sort());
    expect(new Set(sites.map(item=>item.id)).size).toBe(11);
    const [con]=await db`select pg_get_constraintdef(oid) def from pg_constraint
      where conrelid='appointments'::regclass and conname='appointments_client_no_overlap'`;
    expect(con.def).toContain("client_id WITH =");
    expect(con.def).not.toContain("resource_key");
    expect(con.def).not.toContain("assigned_staff");
  });

  it("allows two different clients at exactly the same time, location and resource",async()=>{
    const first=await makeClient(1),second=await makeClient(2);
    const [site]=await db`select id,code from appointment_locations where code='DTW1'`;
    const start=at(32);
    const base={action:"schedule_appointment",scheduled_at:start,duration_minutes:30,
      appointment_type:"Employment interview",resource_key:`staff:${manager.staff.id}`,location_id:site.id,
      location:null,notes:null,confirm_booking:true};
    const [a,b]=await Promise.all([act({...base,client_id:first}),act({...base,client_id:second})]);
    const saved=await db`select id,client_id,location_id,location,status,resource_key,scheduled_at from appointments where id in(${String(a.appointment_id)},${String(b.appointment_id)})`;
    expect(saved).toHaveLength(2);
    expect(saved.every(row=>row.location_id===site.id&&row.location.includes("DTW1")&&row.status==="confirmed")).toBe(true);
    expect(new Set(saved.map(row=>new Date(row.scheduled_at).toISOString())).size).toBe(1);
  });

  it("rejects two concurrent overlapping bookings for ONE client (one succeeds, one exclusion conflict)",async()=>{
    const client=await makeClient(3);
    const start=at(34);
    const input={action:"schedule_appointment",client_id:client,appointment_type:"Office intake",
      scheduled_at:start,duration_minutes:30,resource_key:"office",location:"Career Gate office",notes:null};
    const results=await Promise.allSettled([act(input),act({...input,resource_key:`staff:${manager.staff.id}`})]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    const failed=results.find(r=>r.status==="rejected");
    expect(failed && failed.status==="rejected" ? (failed.reason as {code:string}).code : null).toBe("23P01");
    const [count]=await db`select count(*)::int n from appointments where client_id=${client} and status in('scheduled','confirmed','rescheduled')`;
    expect(count.n).toBe(1);
  });

  it("allows the same instant in two different destination sites",async()=>{
    const first=await makeClient(4),second=await makeClient(5);
    const sites=await db`select id,code from appointment_locations where code in('DET1','DET2') order by code`;
    const start=at(37);
    await Promise.all(sites.map((site,index)=>act({action:"schedule_appointment",
      client_id:index===0?first:second,appointment_type:"Employment interview",
      scheduled_at:start,duration_minutes:30,resource_key:"office",location_id:site.id,location:null,notes:null})));
    const rows=await db`select distinct location_id from appointments where client_id in (${first},${second})`;
    expect(rows).toHaveLength(2);
  });

  it("rejects a conflicting reschedule and retains the original appointment",async()=>{
    const client=await makeClient(6);
    const early=at(38),late=at(39);
    const first=await act({action:"schedule_appointment",client_id:client,appointment_type:"Office intake",
      scheduled_at:early,duration_minutes:30,resource_key:"office",location:"Office",notes:null});
    await act({action:"schedule_appointment",client_id:client,appointment_type:"Document check",
      scheduled_at:late,duration_minutes:30,resource_key:"office",location:"Office",notes:null});
    await expect(act({action:"update_appointment",appointment_id:first.appointment_id,
      scheduled_at:late,location:"Office"})).rejects.toMatchObject({code:"23P01"});
    const [saved]=await db`select scheduled_at from appointments where id=${String(first.appointment_id)}`;
    expect(new Date(saved.scheduled_at).toISOString()).toBe(early);
  });

  it("queues confirmation and 24h reminder only once after approval; invalidates stale messages when rescheduled",async()=>{
    const client=await makeClient(7,true);
    const start=at(40);
    const first=await act({action:"schedule_appointment",client_id:client,appointment_type:"Employment interview",
      scheduled_at:start,duration_minutes:30,resource_key:"office",location:"Career Gate - office",notes:null,
      confirm_booking:true});
    const id=String(first.appointment_id);
    const same=await withStaff(manager,tx=>queueAppointmentNotifications(tx,id,{staffId:manager.staff.id,traceId:"sites-integration"}));
    expect(same).toHaveLength(0);
    const queued=await db`select id,template,status,idempotency_key from notifications where appointment_id=${id} order by template`;
    expect(queued).toHaveLength(2);
    expect(queued.map(row=>row.template).sort()).toEqual(["appointment_confirmation","appointment_reminder_24h"].sort());
    expect(queued.every(row=>row.status==="queued" && row.idempotency_key)).toBe(true);
    const [jobs]=await db`select count(*)::int n from jobs where entity_id=any(${queued.map(row=>row.id)})`;
    expect(jobs.n).toBe(2);
    const second=at(41);
    await act({action:"update_appointment",appointment_id:id,scheduled_at:second,confirm_booking:true});
    const rows=await db`select template,status,payload->>'scheduled_at' start from notifications
      where appointment_id=${id} order by created_at`;
    expect(rows.filter(row=>row.status==="queued")).toHaveLength(2);
    expect(rows.filter(row=>row.status==="failed")).toHaveLength(2);
    expect(rows.filter(row=>row.status==="queued").every(row=>row.start===second)).toBe(true);
    await act({action:"update_appointment",appointment_id:id,status:"confirmed"});
    const [count]=await db`select count(*)::int n from notifications where appointment_id=${id}`;
    expect(count.n).toBe(4);
  });

  it("delivers each approved confirmation once across concurrent workers, recording sent with provider ID",async()=>{
    const client=await makeClient(9,true);
    const appointment=await act({action:"schedule_appointment",client_id:client,appointment_type:"Employment interview",
      scheduled_at:at(45),duration_minutes:30,resource_key:"office",location:"Career Gate office",notes:null,
      confirm_booking:true});
    const [notice]=await db`select id from notifications where appointment_id=${String(appointment.appointment_id)} and template='appointment_confirmation'`;
    let sends=0;
    vi.stubGlobal("fetch",async(url: string,init: RequestInit)=>{
      expect(url).toBe("https://api.resend.com/emails");
      expect(new Headers(init.headers).get("Idempotency-Key")).toContain("appointment:");
      sends++;
      return new Response(JSON.stringify({id:"test-provider-message-id"}),{status:200,headers:{"content-type":"application/json"}});
    });
    try {
      const outcomes=await Promise.all([deliverNotification(String(notice.id)),deliverNotification(String(notice.id))]);
      expect(outcomes.filter(outcome=>outcome.status==="sent")).toHaveLength(1);
      expect(outcomes.filter(outcome=>outcome.status==="skipped")).toHaveLength(1);
      expect(sends).toBe(1);
      const [record]=await db`select status,provider_id,attempts from notifications where id=${notice.id}`;
      expect(record).toMatchObject({status:"sent",provider_id:"test-provider-message-id",attempts:1});
    }finally{vi.unstubAllGlobals();}
  });

  it("records failed delivery without inventing a sent status",async()=>{
    const client=await makeClient(10,true);
    const appointment=await act({action:"schedule_appointment",client_id:client,appointment_type:"Office intake",
      scheduled_at:at(46),duration_minutes:30,resource_key:"office",location:"Career Gate office",notes:null,
      confirm_booking:true});
    const [notice]=await db`select id from notifications where appointment_id=${String(appointment.appointment_id)} and template='appointment_confirmation'`;
    vi.stubGlobal("fetch",async()=>new Response(JSON.stringify({message:"Provider unavailable"}),{status:503,headers:{"content-type":"application/json"}}));
    try {
      const outcome=await deliverNotification(String(notice.id));
      expect(outcome.status).toBe("failed");
      const [record]=await db`select status,provider_id,attempts from notifications where id=${notice.id}`;
      expect(record.status).toBe("failed");
      expect(record.provider_id).toBeNull();
      expect(record.attempts).toBe(1);
    }finally{vi.unstubAllGlobals();}
  });

  it("does not create an email notification when the applicant has not opted into messaging",async()=>{
    const client=await makeClient(8,false);
    const saved=await act({action:"schedule_appointment",client_id:client,appointment_type:"Office intake",
      scheduled_at:at(42),duration_minutes:30,resource_key:"office",location:"Office",notes:null,
      confirm_booking:true});
    const [count]=await db`select count(*)::int n from notifications where appointment_id=${String(saved.appointment_id)}`;
    expect(count.n).toBe(0);
  });
});
