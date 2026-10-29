import "server-only";
import { createHash } from "node:crypto";

import type postgres from "postgres";
import { sql } from "@/lib/db";
import { enqueue } from "@/lib/jobs";

import { registry, providerStates } from "@/lib/providers/config";
import { sendEmail, type SendResult } from "@/lib/providers/messaging";
import { warehouseMapUrl } from "@/lib/amazon-interview-sites";

type Event = "scheduled" | "updated" | "reminder";
type RecipientKind = "client" | "resource";
type Payload = {
  appointmentId: string;
  scheduledAt: string;
  location: string;
  recipient: string;
  clientName: string;
  appointmentType: string;
  event: Event;
  recipientKind: RecipientKind;
};
const isPayload = (value: unknown): value is Payload => {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return ["appointmentId","scheduledAt","location","recipient","clientName","appointmentType","event","recipientKind"]
    .every(key => typeof p[key] === "string")
    && ["scheduled","updated","reminder"].includes(String(p.event))
    && ["client","resource"].includes(String(p.recipientKind));
};
const escapeHtml = (value: string) => value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
const officeDate = (date: string) => new Intl.DateTimeFormat("en-US", {
  timeZone:"America/Detroit", dateStyle:"full", timeStyle:"short",
}).format(new Date(date));

export function renderAppointmentEmail(p: Payload) {
  const date = officeDate(p.scheduledAt);
  const maps = warehouseMapUrl(p.location);
  const resource = p.recipientKind === "resource";
  const subject = resource
    ? `Career Gate · ${p.event === "updated" ? "Updated" : "New"} appointment · ${p.clientName}`
    : p.event === "reminder" ? "Career Gate · Upcoming Appointment Reminder"
      : p.event === "updated" ? "Career Gate · Updated Appointment Confirmation"
      : "Career Gate · Appointment Confirmation";
  const text = [
    "CAREER GATE · ALHIJRAH SERVICES LLC",
    resource ? "Appointment resource notification" : "تأكيد موعدك لدى بوابة التوظيف · Career Gate appointment details",
    `Client: ${p.clientName}`, `Type: ${p.appointmentType}`, `Date (Michigan): ${date}`, `Location: ${p.location}`,
    `Google Maps: ${maps}`,
    "يرجى الوصول قبل موعد المقابلة بنصف ساعة، وإحضار الوثائق الأصلية.",
    "Please arrive 30 minutes early and bring your original documents.",
    "نتمنى لكم التوفيق · CAREER GATE",
  ].join("\n");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:20px;background:#061020;color:#f8fafc;font-family:Arial,Tahoma,sans-serif">
    <main style="max-width:620px;margin:auto;padding:25px;background:#10263e;border:1px solid #c5a059;border-radius:18px">
      <p style="color:#e5c47e;font-weight:700">ALHIJRAH SERVICES LLC · CAREER GATE</p>
      <h1 style="font-size:24px">${escapeHtml(subject)}</h1>
      <p style="line-height:1.7">Applicant: <strong>${escapeHtml(p.clientName)}</strong></p>
      <p>Appointment: ${escapeHtml(p.appointmentType)}</p>
      <p>Michigan time: <strong>${escapeHtml(date)}</strong></p>
      <p>Location: <strong>${escapeHtml(p.location)}</strong></p>
      <a style="display:inline-block;background:#d4af37;color:#071529;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700"
        href="${escapeHtml(maps)}">View Google Maps / عرض الموقع</a>
      <p style="line-height:1.9" dir="rtl">يرجى الوصول قبل موعد المقابلة بنصف ساعة وإحضار الوثائق الأصلية. نتمنى لكم التوفيق.</p>
      <p style="line-height:1.7">Please arrive 30 minutes early and bring your original documents.</p>
      <p style="color:#e5c47e">بوابة التوظيف · Career Gate</p>
    </main>
  </body></html>`;
  return {subject,text,html};
}

export function appointmentEmailIdempotencyKey(payload: Payload) {
  const identity = [
    payload.appointmentId, payload.event, payload.scheduledAt,
    payload.location, payload.appointmentType, payload.recipientKind,
  ];
  return "appointment:" + createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

async function queueOne(tx: postgres.TransactionSql, clientId: string, payload: Payload, traceId: string) {
  const configured = providerStates().email_resend === "CONFIGURED";
  const [row] = await tx`insert into notifications(client_id,channel,template,payload,status,idempotency_key)
    values(${clientId},'email',${`appointment_${payload.event}`},${tx.json(payload)},${configured?"queued":"not_configured"},${appointmentEmailIdempotencyKey(payload)})
    on conflict do nothing returning id`;
  if (configured && row) await enqueue(tx,{type:"notification_send",entityId:String(row.id),dedupeKey:`notify:${row.id}`,traceId});
}

export async function queueAppointmentEmails(
  tx: postgres.TransactionSql,
  appointment: { id: string; client_id: string; scheduled_at: Date; location: string | null; appointment_type: string; resource_key: string },
  event: "scheduled" | "updated",
  traceId: string,
) {
  const [client] = await tx`select full_name,email,communication_consent from clients where id=${appointment.client_id} and deleted_at is null`;
  if (!client) return;
  const base = {
    appointmentId:appointment.id,
    scheduledAt:new Date(appointment.scheduled_at).toISOString(),
    location:appointment.location ?? "Office (contact Career Gate for location)",
    clientName:String(client.full_name),
    appointmentType:appointment.appointment_type,
    event,
  } as const;
  if (client.communication_consent && typeof client.email==="string" && client.email.trim()) {
    await queueOne(tx,appointment.client_id,{...base,recipient:client.email,recipientKind:"client"},traceId);
  }
  const staffId = appointment.resource_key.startsWith("staff:") ? appointment.resource_key.slice(6) : null;
  const [staff] = staffId ? await tx`select email from staff where id=${staffId} and active` : [];
  const resourceEmail = typeof staff?.email === "string" ? staff.email : staffId ? null : registry.app().adminEmail;
  if (resourceEmail && resourceEmail.trim() && resourceEmail !== client.email) {
    await queueOne(tx,appointment.client_id,{...base,recipient:resourceEmail,recipientKind:"resource"},traceId);
  }
}

export async function deliverAppointmentEmail(notificationId: string, payload: unknown): Promise<SendResult | {status:"skipped"}> {
  const db = sql();
  if (!isPayload(payload)) throw new Error("Invalid appointment email payload");
  const [notification] = await db`update notifications
    set status='sending',attempts=attempts+1
    where id=${notificationId} and status='queued'
    returning id,client_id`;
  if (!notification) return {status:"skipped"};
  const [current] = await db`select a.id,a.scheduled_at,a.location,a.appointment_type,a.status,a.resource_key,
        c.email,c.communication_consent,c.deleted_at
    from appointments a join clients c on c.id=a.client_id
    where a.id=${payload.appointmentId} and a.client_id=${notification.client_id}`;
  const currentTime = current ? new Date(current.scheduled_at).toISOString() : null;
  const staffRecipient = current?.resource_key && String(current.resource_key).startsWith("staff:")
    ? await db`select email from staff where id=${String(current.resource_key).slice(6)} and active` : [];
  const authorizedRecipient = payload.recipientKind === "client"
    ? Boolean(current?.communication_consent && current?.email === payload.recipient)
    : Boolean(
        staffRecipient?.[0]?.email === payload.recipient ||
        (!String(current?.resource_key ?? "").startsWith("staff:") && registry.app().adminEmail === payload.recipient)
      );
  const stale = !current || current.deleted_at || !["scheduled","confirmed","rescheduled"].includes(String(current.status))
    || currentTime !== payload.scheduledAt || String(current.appointment_type) !== payload.appointmentType
    || (current.location ?? "Office (contact Career Gate for location)") !== payload.location
    || !authorizedRecipient;
  if (stale) {
    await db`update notifications set status='not_configured',error='Appointment changed or cancelled before delivery' where id=${notificationId}`;
    return {status:"skipped"};
  }
  const message = renderAppointmentEmail(payload);
  const result = await sendEmail(payload.recipient,message.subject,message.text,message.html);
  if (result.status==="sent") {
    await db`update notifications set status='sent',provider=${result.provider},provider_id=${result.provider_id},
      sent_at=now(),error=null where id=${notificationId}`;
  } else if (result.status==="not_configured") {
    await db`update notifications set status='not_configured',provider=${result.provider} where id=${notificationId}`;
  } else {
    await db`update notifications set status='failed',provider=${result.provider},error=${result.error.slice(0,500)} where id=${notificationId}`;
  }
  return result;
}

export async function queueAdvanceAppointmentReminders() {
  const db = sql();
  if (providerStates().email_resend !== "CONFIGURED") return 0;
  const eligible = await db`
    select a.id,a.client_id,a.scheduled_at,a.location,a.appointment_type,
           c.full_name,c.email
    from appointments a join clients c on c.id=a.client_id
    where a.status in ('confirmed','rescheduled')
      and c.deleted_at is null and c.communication_consent and c.email is not null
      and a.scheduled_at >= now()+interval '24 hours'
      and a.scheduled_at < now()+interval '48 hours'
    order by a.scheduled_at limit 250`;
  let queued=0;
  for(const appointment of eligible) {
    await db.begin(async tx => {
      const payload:Payload={
        appointmentId:String(appointment.id),scheduledAt:new Date(appointment.scheduled_at).toISOString(),
        location:String(appointment.location ?? "Office (contact Career Gate for location)"),
        clientName:String(appointment.full_name),appointmentType:String(appointment.appointment_type),
        recipient:String(appointment.email),recipientKind:"client",event:"reminder",
      };
      const [row] = await tx`insert into notifications(client_id,channel,template,payload,status,idempotency_key)
        values(${appointment.client_id},'email','appointment_reminder',${tx.json(payload)},'queued',${appointmentEmailIdempotencyKey(payload)})
        on conflict do nothing returning id`;
      if(row){await enqueue(tx,{type:"notification_send",entityId:String(row.id),dedupeKey:`notify:${row.id}`});queued++;}
    });
  }
  return queued;
}
