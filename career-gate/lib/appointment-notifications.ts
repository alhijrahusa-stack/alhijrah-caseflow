import "server-only";

import { z } from "zod";
import type postgres from "postgres";
import { enqueue } from "@/lib/jobs";
import { providerStates } from "@/lib/providers/config";
import { logActivity, type Actor } from "@/lib/service";
import { dateTime } from "@/lib/format";

export const AppointmentNotificationSchema = z.object({
  appointment_id: z.uuid(),
  scheduled_at: z.iso.datetime({ offset: true }),
  location: z.string().max(300),
  appointment_type: z.string().min(1).max(100),
  recipient_email: z.email(),
  full_name: z.string().min(1).max(160),
  maps_url: z.url(),
});

export type AppointmentNotificationPayload = z.infer<typeof AppointmentNotificationSchema>;
export type AppointmentNotificationKind = "appointment_confirmation" | "appointment_reminder_24h";

export function appointmentMapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export function renderAppointmentNotification(kind: AppointmentNotificationKind, data: AppointmentNotificationPayload) {
  const reminder = kind === "appointment_reminder_24h";
  const date = dateTime(data.scheduled_at);
  const subject = reminder
    ? `CAREER GATE · Appointment Reminder · ${date}`
    : `CAREER GATE · Confirmed Appointment · ${date}`;
  const text = [
    `Dear ${data.full_name},`,
    "",
    reminder ? "This is your reminder for your upcoming appointment." : "Your appointment has been confirmed.",
    `Appointment: ${data.appointment_type}`,
    `Date & time (Michigan): ${date}`,
    `Location: ${data.location}`,
    `Google Maps: ${data.maps_url}`,
    "",
    "Please arrive 30 minutes before your scheduled time.",
    "Bring your original documents to your appointment.",
    "",
    "يرجى الوصول قبل موعد المقابلة بنصف ساعة.",
    "يرجى إحضار الوثائق الأصلية للمقابلة.",
    "نتمنى لكم التوفيق.",
    "",
    "بوابة التوظيف · Career Gate",
    "ALHIJRAH SERVICES LLC",
  ].join("\n");
  return { subject, text };
}

/** Enqueued atomically inside the appointment transaction, never before approval. */
export async function queueAppointmentNotifications(
  tx: postgres.TransactionSql,
  appointmentId: string,
  actor: Actor,
) {
  const [appointment] = await tx`
    select a.id,a.client_id,a.scheduled_at,a.location,a.appointment_type,a.status,
      c.email,c.full_name,c.communication_consent
    from appointments a join clients c on c.id=a.client_id
    where a.id=${appointmentId} and c.deleted_at is null`;
  if (!appointment || appointment.status !== "confirmed"
      || !appointment.communication_consent || !appointment.email || !appointment.location) return [];
  const data = AppointmentNotificationSchema.parse({
    appointment_id: appointment.id,
    scheduled_at: new Date(appointment.scheduled_at).toISOString(),
    location: String(appointment.location),
    appointment_type: String(appointment.appointment_type),
    recipient_email: String(appointment.email),
    full_name: String(appointment.full_name),
    maps_url: appointmentMapsUrl(String(appointment.location)),
  });
  const confirmedAt = new Date(data.scheduled_at).getTime();
  const scheduled = [
    { kind: "appointment_confirmation" as const, runAfter: new Date() },
    ...(confirmedAt > Date.now() + 24 * 60 * 60_000
      ? [{ kind: "appointment_reminder_24h" as const, runAfter: new Date(confirmedAt - 24 * 60 * 60_000) }]
      : []),
  ];
  const result: { id: string; kind: AppointmentNotificationKind; status: string }[] = [];
  for (const {kind, runAfter} of scheduled) {
    const ready = providerStates().email_resend === "CONFIGURED";
    const key = `appointment:${appointment.id}:${kind}:${data.scheduled_at}`;
    const status = ready ? "queued" : "failed";
    const [row] = await tx`insert into notifications
      (client_id,appointment_id,channel,template,payload,status,idempotency_key,error)
      values (${appointment.client_id},${appointment.id},'email',${kind},${tx.json(data)},
        ${status},${key},${ready ? null : "Email provider not configured"})
      on conflict (idempotency_key) where idempotency_key is not null do nothing
      returning id,status`;
    if (!row) continue;
    result.push({id:String(row.id),kind,status});
    if (ready) {
      await enqueue(tx,{type:"notification_send",entityId:String(row.id),
        dedupeKey:`notify:${row.id}`,traceId:actor.traceId,runAfter});
    }
    await logActivity(tx,{clientId:String(appointment.client_id),actor,
      action:ready?"notification_queued":"notification_failed",
      entityType:"notification",entityId:String(row.id),
      newValue:{kind,channel:"email",status,scheduled_at:data.scheduled_at}});
  }
  return result;
}

/** Prevent stale queued messages if an appointment is changed or cancelled. */
export async function invalidateAppointmentNotifications(
  tx: postgres.TransactionSql, appointmentId: string,
) {
  await tx`update notifications set status='failed',
    error='Booking changed before delivery',updated_at=now()
    where appointment_id=${appointmentId} and status='queued'
      and template in ('appointment_confirmation','appointment_reminder_24h')`;
}
