import "server-only";
import { z } from "zod";
import type postgres from "postgres";
import { sql } from "@/lib/db";
import { enqueue } from "@/lib/jobs";
import { OFFICE } from "@/lib/office";
import { dateOnly, dateTime } from "@/lib/format";
import { providerStates } from "@/lib/providers/config";
import { sendEmail, type SendResult } from "@/lib/providers/messaging";

const Payload = z.object({
  changeId: z.uuid(), clientName: z.string().min(1), clientRef: z.string().min(1),
  recipient: z.email(), currentSiteName: z.string(), finalSiteName: z.string().min(1),
  finalSiteAddress: z.string().min(1), shiftDays: z.string().min(1),
  shiftStart: z.string().regex(/^\d{2}:\d{2}$/), shiftEnd: z.string().regex(/^\d{2}:\d{2}$/),
  newStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), confirmedAt: z.iso.datetime({ offset: true }),
  timezone: z.literal("America/Detroit"),
});
export type WorksiteChangeEmailPayload = z.infer<typeof Payload>;
const escapeHtml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
export const worksiteChangeEmailKey = (changeId: string) => `worksite-change:${changeId}`;

export function renderWorksiteChangeEmail(payload: WorksiteChangeEmailPayload) {
  const p = Payload.parse(payload);
  const subject = `Career Gate · Worksite Change Confirmation · ${p.clientRef}`;
  const details = [
    ["Client / العميل", p.clientName], ["Reference / رقم الملف", p.clientRef],
    ["Previous worksite / الموقع السابق", p.currentSiteName],
    ["Confirmed worksite / الموقع الجديد المؤكد", p.finalSiteName],
    ["Worksite address / عنوان موقع العمل", p.finalSiteAddress],
    ["Shift days / أيام العمل", p.shiftDays],
    ["Shift time / وقت الشفت", `${p.shiftStart} – ${p.shiftEnd} (${p.timezone})`],
    ["New start date / تاريخ البداية الجديد", dateOnly(p.newStartDate)],
    ["Change confirmed / تاريخ ووقت تأكيد التغيير", `${dateTime(p.confirmedAt)} (${p.timezone})`],
  ];
  const opening = "We confirm that your worksite has been changed to the location below. Your confirmed work schedule and new start date are set out in this notice.";
  const arabic = "نؤكد لكم إتمام تغيير موقع العمل إلى الموقع الموضح أدناه. يرجى مراجعة عنوان الموقع وأيام وساعات العمل وتاريخ البداية الجديد الواردة في هذا الإشعار.";
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.finalSiteAddress)}`;
  const text = [OFFICE.product, OFFICE.company, "Worksite Change Confirmation / تأكيد تغيير موقع العمل", opening, arabic,
    ...details.map(([label, value]) => `${label}: ${value}`), `Location map / خريطة الموقع: ${map}`,
    "For assistance with these arrangements, please contact our office.", "لأي استفسار بشأن هذه الترتيبات، يرجى التواصل مع المكتب.",
    `${OFFICE.email} · ${OFFICE.phone}`, "Client Services | Career Gate",
  ].join("\n\n");
  const rows = details.map(([label, value]) => `<tr><td style="padding:12px 0;border-bottom:1px solid #d4af3733;color:#bcd2e8;font-size:12px">${escapeHtml(label)}</td><td style="padding:12px 0 12px 16px;border-bottom:1px solid #d4af3733;color:#f4f8ff;font-weight:600;line-height:1.7">${escapeHtml(value)}</td></tr>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#060e24;padding:24px 12px;font-family:Arial,Tahoma,sans-serif;color:#eef5ff"><main style="max-width:660px;margin:auto;background:#0f1f45;border:1px solid #34d39980;border-radius:24px;padding:28px"><p style="color:#e7cb88;font-size:12px;letter-spacing:2px;font-weight:700">CAREER GATE · CLIENT SERVICES</p><h1 style="font-size:25px;line-height:1.4">Worksite Change Confirmation</h1><h2 dir="rtl" style="font-size:20px;color:#e7cb88">تأكيد تغيير موقع العمل</h2><p style="line-height:1.8">${opening}</p><p dir="rtl" style="line-height:1.9">${arabic}</p><table role="presentation" style="width:100%;border-collapse:collapse">${rows}</table><p style="margin:24px 0"><a href="${escapeHtml(map)}" style="display:inline-block;background:#e7cb88;color:#060e24;border-radius:12px;padding:12px 18px;text-decoration:none;font-weight:700">View worksite map / عرض خريطة الموقع</a></p><p style="line-height:1.8;font-size:13px">For assistance with these arrangements, please contact our office.<br><span dir="rtl">لأي استفسار بشأن هذه الترتيبات، يرجى التواصل مع المكتب.</span></p><footer style="border-top:1px solid #d4af3755;padding-top:18px;color:#bcd2e8;font-size:12px;line-height:1.8">${escapeHtml(OFFICE.company)}<br>${OFFICE.email} · ${OFFICE.phone}</footer></main></body></html>`;
  return { subject, text, html };
}

/** Called in the confirmation transaction: the decision and its outbox commit together. */
export async function queueWorksiteChangeEmail(tx: postgres.TransactionSql, clientId: string, payload: WorksiteChangeEmailPayload, traceId: string) {
  const value = Payload.parse(payload);
  const configured = providerStates().email_resend === "CONFIGURED";
  const key = worksiteChangeEmailKey(value.changeId);
  const [created] = await tx`insert into notifications(client_id,channel,template,payload,status,idempotency_key)
    values(${clientId},'email','worksite_change_confirmed',${tx.json(value)},${configured ? "queued" : "not_configured"},${key})
    on conflict do nothing returning id,status`;
  const row = created ?? (await tx`select id,status from notifications where client_id=${clientId} and idempotency_key=${key}`)[0];
  if (!row) throw new Error("Worksite confirmation outbox could not be created");
  if (configured && created) await enqueue(tx, { type: "notification_send", entityId: String(row.id), dedupeKey: `notify:${row.id}`, traceId });
  return { id: String(row.id), status: String(row.status) };
}

/** Revalidates the immutable decision and the current profile before contacting the provider. */
export async function deliverWorksiteChangeEmail(notificationId: string, raw: unknown): Promise<SendResult | { status: "skipped" }> {
  const parsed = Payload.safeParse(raw);
  if (!parsed.success) throw new Error("Invalid worksite confirmation payload");
  const p = parsed.data;
  const db = sql();
  const [notification] = await db`update notifications set status='sending',attempts=attempts+1
    where id=${notificationId} and template='worksite_change_confirmed' and status in ('queued','sending') and sent_at is null
    returning id,client_id,idempotency_key`;
  if (!notification) return { status: "skipped" };
  const [record] = await db`select w.*,c.email,c.communication_consent,c.deleted_at,c.full_name,c.ref
    from worksite_changes w join clients c on c.id=w.client_id
    where w.id=${p.changeId} and w.client_id=${notification.client_id} and w.notification_id=${notificationId} and w.status='confirmed'
      and not exists(select 1 from worksite_changes newer where newer.client_id=w.client_id
        and newer.status='confirmed' and (newer.recorded_at,newer.id)>(w.recorded_at,w.id))`;
  const calendarDate = (value: unknown) => value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const matches = record && notification.idempotency_key === worksiteChangeEmailKey(p.changeId)
    && !record.deleted_at && record.communication_consent && record.email === p.recipient
    && record.final_site_name === p.finalSiteName && record.final_site_address === p.finalSiteAddress
    && record.current_site_name === p.currentSiteName && record.shift_days === p.shiftDays
    && String(record.shift_start).slice(0, 5) === p.shiftStart && String(record.shift_end).slice(0, 5) === p.shiftEnd
    && calendarDate(record.new_start_date) === p.newStartDate && new Date(record.confirmed_at).toISOString() === new Date(p.confirmedAt).toISOString()
    && record.full_name === p.clientName && record.ref === p.clientRef;
  if (!matches) {
    const error = "Confirmation or profile details changed before delivery; review the current client record";
    await db`update notifications set status='failed',error=${error} where id=${notificationId}`;
    return { status: "failed", provider: "resend", retryable: false, error };
  }
  const message = renderWorksiteChangeEmail(p);
  const result = await sendEmail(p.recipient, message.subject, message.text, message.html, String(notification.idempotency_key ?? worksiteChangeEmailKey(p.changeId)));
  if (result.status === "sent") {
    await db`update notifications set status='sent',provider=${result.provider},provider_id=${result.provider_id},sent_at=now(),error=null where id=${notificationId}`;
  } else if (result.status === "not_configured") {
    await db`update notifications set status='not_configured',provider=${result.provider},error='Email provider is not configured' where id=${notificationId}`;
  } else {
    await db`update notifications set status='failed',provider=${result.provider},error=${result.error.slice(0,500)} where id=${notificationId}`;
  }
  return result;
}
