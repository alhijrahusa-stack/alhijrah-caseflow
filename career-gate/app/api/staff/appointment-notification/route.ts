import { z } from "zod";
import { staffGuard, authorize } from "@/lib/staff-api";
import { withStaff } from "@/lib/auth";
import { err, ok } from "@/lib/http";
import { renderAppointmentCard, DOCUMENTS } from "@/lib/appointment-notification-card";
import { sendEmail } from "@/lib/providers/messaging";
import { channelConfigured } from "@/lib/notify";
import { logActivity } from "@/lib/service";
import { sql } from "@/lib/db";
export const runtime = "nodejs";
const schema = z.object({
 appointmentId: z.uuid(),
 language: z.enum(["ar","en","both"]),
 documents: z.array(z.enum(DOCUMENTS.map(d=>d.id) as [typeof DOCUMENTS[number]["id"],...typeof DOCUMENTS[number]["id"][]])).max(7),
 mode: z.enum(["preview","send"]),
});
const date = (value: string | Date, language: "ar" | "en" | "both") => new Intl.DateTimeFormat(language === "en" ? "en-US" : "ar", {timeZone:"America/Detroit",dateStyle:"full",timeStyle:"short"}).format(new Date(value));
export async function POST(req: Request) {
 const guard = await staffGuard(req,crypto.randomUUID(),{mutation:true});
 if (guard.response) return guard.response;
 const input = schema.safeParse(await req.json().catch(()=>null));
 if (!input.success) return err("invalid_input","Invalid appointment notification request",400);
 const {appointmentId,language,documents,mode} = input.data;
 const appt = await withStaff(guard.session, async tx => {
   const [row] = await tx`select a.id,a.client_id,a.status,a.scheduled_at,a.location,c.full_name,c.email,c.phone
     from appointments a join clients c on c.id=a.client_id where a.id=${appointmentId} and c.deleted_at is null`;
   return row;
 });
 if (!appt) return err("not_found","Appointment not found",404);
 const authz = await authorize(req,guard.session,"send_notification",{clientId:appt.client_id as string},crypto.randomUUID());
 if (!authz.ok) return authz.response;
 if (!appt.email) return err("email_required","Client email required",400);
 let card: ReturnType<typeof renderAppointmentCard>;
 try {card=renderAppointmentCard({clientName:appt.full_name as string,date:date(appt.scheduled_at as Date,language),location:appt.location as string || "",status:appt.status as string,email:appt.email as string,phone:appt.phone as string,documents,language});}
 catch(e){return err("invalid_appointment",e instanceof Error?e.message:"Invalid appointment",400);}
 if(mode==="preview") return ok({html:card.html,subject:card.subject});
 if(!channelConfigured("email")) return err("email_unavailable","Email provider is not configured",503);
 // Prevent concurrent double clicks by locking the appointment row, and suppress exact repeat sends.
 const fingerprint = JSON.stringify({appointmentId,language,documents:[...documents].sort(),date:String(appt.scheduled_at),location:appt.location});
 const claimed = await sql().begin(async tx=>{
   await tx`select id from appointments where id=${appointmentId} for update`;
   const [existing] = await tx`select id from notifications where client_id=${appt.client_id}
     and template='appointment_confirmation' and payload->>'fingerprint'=${fingerprint}
     and status in ('sending','sent','queued') limit 1`;
   if(existing)return false;
   await tx`insert into notifications (client_id,channel,template,payload,status)
     values (${appt.client_id},'email','appointment_confirmation',${tx.json({fingerprint,appointmentId})},'sending')`;
   return true;
 });
 if(!claimed)return err("duplicate","This confirmation was already submitted",409);
 const result=await sendEmail(appt.email as string,card.subject,card.text,card.html);
 await sql().begin(async tx=>{
   await tx`update notifications set status=${result.status==="sent"?"sent":result.status==="failed"?"failed":"not_configured"},
     provider=${result.provider},provider_id=${result.status==="sent"?result.provider_id:null},
     sent_at=${result.status==="sent"?new Date():null},error=${result.status==="failed"?result.error.slice(0,500):null}
     where client_id=${appt.client_id} and template='appointment_confirmation' and payload->>'fingerprint'=${fingerprint} and status='sending'`;
   await logActivity(tx,{clientId:appt.client_id as string,action:result.status==="sent"?"notification_sent":"notification_failed",
     actor:{staffId:guard.session.staff.id,traceId:crypto.randomUUID()},entityType:"appointment",entityId:appointmentId,
     newValue:{channel:"email",status:result.status}});
 });
 if(result.status!=="sent")return err("delivery_failed","Provider did not accept the message",502);
 return ok({status:"accepted_by_provider",providerId:result.provider_id});
}
