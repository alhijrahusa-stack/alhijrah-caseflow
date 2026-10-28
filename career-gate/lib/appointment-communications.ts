import "server-only";
import type postgres from "postgres";
import { enqueue } from "@/lib/jobs";
import { warehouseMapUrl } from "@/lib/amazon-interview-sites";
import { channelConfigured } from "@/lib/notify";

export type AppointmentNoticeType = "appointment_auto_confirmation" | "appointment_reminder" | "appointment_staff_notice";
export type AppointmentNoticePayload = { appointmentId: string; scheduledAt: string; kind: AppointmentNoticeType };

type AppointmentNotice = {
  id: string; client_id: string; full_name: string; email: string | null;
  communication_consent: boolean; scheduled_at: Date; appointment_type: string;
  location: string | null; resource_key: string; status: string;
};

export async function queueAppointmentNotice(
  tx: postgres.TransactionSql,
  appointmentId: string,
  traceId: string,
  options: { reminder?: boolean } = {},
): Promise<{ queued: number; missingContact: boolean }> {
  const [appointment] = await tx`
    select a.id,a.client_id,a.scheduled_at,a.appointment_type,a.location,a.resource_key,a.status,
           c.full_name,c.email,c.communication_consent
    from appointments a join clients c on c.id=a.client_id
    where a.id=${appointmentId} and c.deleted_at is null` as unknown as AppointmentNotice[];
  if (!appointment || !["scheduled","confirmed","rescheduled"].includes(appointment.status))
    return { queued: 0, missingContact: false };

  const scheduledAt = new Date(appointment.scheduled_at).toISOString();
  const kind: AppointmentNoticeType = options.reminder ? "appointment_reminder" : "appointment_auto_confirmation";
  const hasClientEmail = Boolean(appointment.communication_consent && appointment.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(appointment.email));
  let queued = 0;
  if (hasClientEmail) {
    const payload: AppointmentNoticePayload = { appointmentId, scheduledAt, kind };
    const [n] = await tx`insert into notifications(client_id,channel,template,payload,status)
      values (${appointment.client_id},'email',${kind},${tx.json(payload)},${channelConfigured("email") ? "queued" : "not_configured"})
      on conflict do nothing returning id,status`;
    if (n?.status === "queued") {
      await enqueue(tx,{type:"notification_send",entityId:String(n.id),dedupeKey:`appointment-notice:${n.id}`,traceId});
      queued++;
    }
  }
  if (!options.reminder && appointment.resource_key.startsWith("staff:")) {
    const [staff] = await tx`select id,email from staff where id=${appointment.resource_key.slice(6)} and active`;
    if (staff?.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(staff.email))) {
      const payload: AppointmentNoticePayload = { appointmentId, scheduledAt, kind:"appointment_staff_notice" };
      const [n] = await tx`insert into notifications(client_id,channel,template,payload,status)
        values (${appointment.client_id},'email','appointment_staff_notice',${tx.json(payload)},${channelConfigured("email") ? "queued" : "not_configured"})
        on conflict do nothing returning id,status`;
      if (n?.status === "queued") {
        await enqueue(tx,{type:"notification_send",entityId:String(n.id),dedupeKey:`appointment-notice:${n.id}`,traceId});
        queued++;
      }
    }
  }
  return { queued, missingContact: !hasClientEmail };
}

export function appointmentEmailMessage(input: {
  clientName: string; date: Date | string; location: string | null; appointmentType: string;
  reminder: boolean; staffNotice?: boolean;
}): { subject: string; text: string; html: string } {
  const time = new Intl.DateTimeFormat("en-US",{timeZone:"America/Detroit",dateStyle:"full",timeStyle:"short"}).format(new Date(input.date));
  const location = input.location?.trim() || "Career Gate office — confirm address with staff";
  const map = warehouseMapUrl(location);
  const subject = input.staffNotice ? "CAREER GATE | Staff appointment booked"
    : input.reminder ? "CAREER GATE | 24-hour appointment reminder" : "CAREER GATE | Appointment confirmed";
  const intro = input.reminder ? "تذكير: موعدكم خلال 24 ساعة تقريباً." : "تم اعتماد وتسجيل موعدكم في بوابة التوظيف.";
  const lines = [
    input.staffNotice ? "Staff schedule update" : intro,
    `العميل / Applicant: ${input.clientName}`,
    `نوع الموعد / Appointment: ${input.appointmentType}`,
    `الوقت بتوقيت ديترويت / Detroit time: ${time}`,
    `الموقع / Location: ${location}`,
    `Google Maps: ${map}`,
    "يرجى الوصول قبل موعد المقابلة بنصف ساعة وإحضار الوثائق الأصلية للمقابلة.",
    "Please arrive 30 minutes before the interview and bring original documents.",
    "نتمنى لكم التوفيق — بوابة التوظيف / Career Gate",
  ];
  const text = lines.join("\n");
  const escape = (s: string) => s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c] ?? c));
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>'
    +'<body style="margin:0;padding:24px 12px;background:#071325;color:#eef3fa;font-family:Arial,Tahoma,sans-serif">'
    +'<main style="max-width:620px;margin:auto;padding:25px;border:1px solid #c7a357;border-radius:18px;background:#102840">'
    +'<h1 style="margin:0 0 18px;color:#f4d38a">CAREER GATE · بوابة التوظيف</h1>'
    +'<p style="line-height:1.9;color:#fff">'+escape(intro)+'</p>'
    +lines.slice(1,5).map(line=>'<p style="line-height:1.8;border-bottom:1px solid #30465b;padding:7px 0">'+escape(line)+'</p>').join("")
    +'<p><a href="'+escape(map)+'" style="display:block;padding:13px;background:#e5b94b;border-radius:10px;text-align:center;color:#0b1825;font-weight:bold;text-decoration:none">Google Maps · فتح الموقع</a></p>'
    +'<p style="line-height:1.9" dir="rtl">يرجى الوصول قبل موعد المقابلة بنصف ساعة، وإحضار الوثائق الأصلية للمقابلة. نتمنى لكم التوفيق.</p>'
    +'<p style="line-height:1.9">Please arrive 30 minutes early and bring your original documents.</p>'
    +'<p style="color:#f4d38a;font-weight:bold">ALHIJRAH SERVICES LLC · CAREER GATE</p></main></body></html>';
  return {subject,text,html};
}
