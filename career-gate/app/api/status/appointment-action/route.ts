import { cookies } from "next/headers";
import { z } from "zod";
import { sql } from "@/lib/db";
import { sessionStatusSubject, STATUS_COOKIE } from "@/lib/status-access";
import { suggestSlots } from "@/lib/scheduling";
import { logActivity } from "@/lib/service";
import { err, ok } from "@/lib/http";
import { isTrustedMutationOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
const schema = z.object({
  ref: z.string().min(1).max(80),
  appointmentId: z.uuid(),
  action: z.enum(["confirm", "reschedule", "cancel"]),
  slotStart: z.iso.datetime().optional(),
  reason: z.string().trim().min(5).max(1000).optional(),
});
async function subject(ref: string) {
  const token = (await cookies()).get(STATUS_COOKIE)?.value;
  return sessionStatusSubject(ref.trim().toUpperCase(), token);
}
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ref = url.searchParams.get("ref") || "";
  const appointmentId = url.searchParams.get("appointmentId") || "";
  if (!ref || !z.uuid().safeParse(appointmentId).success) return err("invalid_input", "Invalid request", 400);
  const verified = await subject(ref);
  if (!verified?.clientId) return err("verification_required", "Verify your file first", 401);
  const db = sql();
  const [appt] = await db`select id, resource_key, appointment_type, scheduled_at, ends_at, status from appointments where id=${appointmentId} and client_id=${verified.clientId}`;
  if (!appt || !["scheduled", "confirmed", "rescheduled"].includes(String(appt.status))) return err("not_found", "Active appointment not found", 404);
  const duration = Math.max(15, Math.round((new Date(appt.ends_at).getTime() - new Date(appt.scheduled_at).getTime()) / 60000));
  const slots = await suggestSlots(db, { resourceKey: String(appt.resource_key), appointmentType: String(appt.appointment_type), durationMinutes: duration, count: 20, days: 21 });
  return ok({ slots: slots.map(s => ({ start: s.start })) });
}
export async function POST(req: Request) {
  if (!isTrustedMutationOrigin(req)) return err("invalid_origin","Invalid request origin",403);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("invalid_input", "Invalid appointment action", 400);
  const {ref, appointmentId, action, slotStart, reason} = parsed.data;
  if (action === "reschedule" && !slotStart) return err("slot_required", "Select an available time", 400);
  if (action === "cancel" && !reason) return err("reason_required", "Please provide the cancellation reason", 400);
  const verified = await subject(ref);
  if (!verified?.clientId) return err("verification_required", "Verify your file first", 401);
  const db = sql();
  const traceId = crypto.randomUUID();
  try {
    const result = await db.begin(async tx => {
      const [a] = await tx`select id,client_id,status,scheduled_at,ends_at,resource_key,appointment_type from appointments where id=${appointmentId} and client_id=${verified.clientId} for update`;
      if (!a || !["scheduled","confirmed","rescheduled"].includes(String(a.status))) return {code:"not_found"} as const;
      const [previous] = await tx`select id from activity_log where client_id=${verified.clientId} and entity_id=${appointmentId} and action='appointment_updated' and new_value->>'client_action'=${action} and (new_value->>'appointment_at')=${new Date(a.scheduled_at).toISOString()} order by created_at desc limit 1`;
      if (previous && action !== "reschedule") return {code:"already_submitted"} as const;
      if (action === "reschedule") {
        const duration = Math.max(15,Math.round((new Date(a.ends_at).getTime()-new Date(a.scheduled_at).getTime())/60000));
        const slots = await suggestSlots(tx,{resourceKey:String(a.resource_key),appointmentType:String(a.appointment_type),durationMinutes:duration,count:100,days:21});
        if (!slots.some(s=>s.start===slotStart)) return {code:"slot_unavailable"} as const;
      }
      if (action === "confirm" && a.status === "scheduled") await tx`update appointments set status='confirmed',updated_at=now() where id=${appointmentId}`;
      if (action === "cancel") await tx`update appointments set status='cancelled',updated_at=now() where id=${appointmentId}`;
      await logActivity(tx,{clientId:verified.clientId!,action:"appointment_updated",actor:{staffId:null,traceId},entityType:"appointment",entityId:appointmentId,newValue:{client_action:action,appointment_at:new Date(a.scheduled_at).toISOString(),requested_slot:action==="reschedule"?slotStart:null,cancellation_reason:action==="cancel"?reason:null,client_acknowledged:action==="confirm",received_at:new Date().toISOString()}});
      return {code:"ok"} as const;
    });
    if (result.code==="not_found") return err("not_found","Appointment not active",404);
    if (result.code==="already_submitted") return err("duplicate","Already submitted",409);
    if (result.code==="slot_unavailable") return err("slot_unavailable","The selected slot is no longer available",409);
    return ok({status: action==="reschedule"?"reschedule_requested":action==="confirm"?"client_acknowledged":"cancelled"});
  } catch { return err("action_failed","Unable to update appointment. Please try again.",500); }
}
