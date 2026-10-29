import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { ActionSchema, runAction } from "@/lib/actions";
import { withStaff, type StaffSession } from "@/lib/auth";
import { AMAZON_APPOINTMENT_SITES } from "@/lib/amazon-appointment-sites";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";

const db = postgres(process.env.DATABASE_URL!, {prepare:false,max:5});
let manager:StaffSession;
let n=0;
const when=new Date(Date.now()+19*86400000).toISOString();
async function createClient() {
  const serial=++n;
  return db.begin(tx=>insertClient(tx,{
    source:"staff_manual",
    profile:ProfileSchema.parse({full_name:`TEST Appointment ${serial}`,phone:`313555${String(7100+serial)}`,employment_history:[]}),
    primary:[],backup:[],status:"new_intake",nextStep:null,
    assignedStaff:manager.staff.id,createdBy:manager.staff.id,communicationConsent:false
  },{staffId:manager.staff.id,traceId:"site-test"}));
}
const act=(payload:Record<string,unknown>)=>withStaff(manager,tx=>runAction({
  tx,actor:{staffId:manager.staff.id,traceId:"site-test"},role:"manager",semantic:[],
},ActionSchema.parse(payload)));
beforeAll(async()=>{
  const user=randomUUID(),email=`site-${user}@test.invalid`;
  await db`insert into auth.users(id,email) values(${user},${email})`;
  const [row]=await db`insert into staff(display_name,email,role,auth_user_id)
    values('TEST Site Manager',${email},'manager',${user}) returning id,display_name,email,role`;
  manager={authUserId:user,staff:row as StaffSession["staff"]};
});
afterAll(()=>db.end());

describe("client-only overlap and warehouse location staging",()=>{
  it("seeds the eleven Amazon interview sites exactly",async()=>{
    const rows=await db`select code,full_address from appointment_amazon_sites`;
    expect(rows.length).toBe(11);
    for(const site of AMAZON_APPOINTMENT_SITES)
      expect(rows.find(row=>row.code===site.code)?.full_address).toBe(site.address);
  });
  it("allows simultaneous bookings for different clients at the same second and branch",async()=>{
    const [a,b]=await Promise.all([createClient(),createClient()]);
    const base={action:"schedule_appointment",scheduled_at:when,appointment_type:"Interview",
      duration_minutes:30,location_id:"DTW1"};
    const [first,second]=await Promise.all([act({...base,client_id:a.id}),act({...base,client_id:b.id})]);
    expect(first.appointment_id).not.toBe(second.appointment_id);
    const rows=await db`select location_id,location from appointments where id in (${first.appointment_id},${second.appointment_id})`;
    expect(rows.length).toBe(2);
    expect(rows.every(row=>row.location_id==="DTW1")).toBe(true);
  });
  it("rejects two concurrent appointments for the same client and repeats the same booking key safely",async()=>{
    const c=await createClient(),key=randomUUID();
    const base={action:"schedule_appointment",client_id:c.id,scheduled_at:when,
      appointment_type:"Interview",duration_minutes:30,location_id:"DET6"};
    const first=await act({...base,booking_key:key});
    expect(await act({...base,booking_key:key})).toMatchObject({appointment_id:first.appointment_id,idempotent:true});
    await expect(act({...base,booking_key:randomUUID()})).rejects.toMatchObject({code:"23P01"});
  });
  it("rejects moving a booking to an occupied period of the same client",async()=>{
    const c=await createClient();
    const base={action:"schedule_appointment",client_id:c.id,appointment_type:"Interview",duration_minutes:30};
    const first=await act({...base,scheduled_at:when});
    const next=new Date(new Date(when).getTime()+3600000).toISOString();
    await act({...base,scheduled_at:next});
    await expect(act({action:"update_appointment",appointment_id:first.appointment_id,scheduled_at:next,location_id:"DET3"}))
      .rejects.toMatchObject({code:"23P01"});
  });
});
