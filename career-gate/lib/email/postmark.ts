import "server-only";
import { sql } from "@/lib/db";

export const PUBLIC_INTAKE_CONFIRMATION_TEMPLATE = "public_intake_confirmation";

export type ConfirmationLocale = "ar" | "en";
export type ConfirmationPayload = {
  clientName: string;
  caseNumber: string;
  submittedAt: string;
  trackingUrl: string;
  service: string;
  email: string;
  phone: string;
  workType: string;
  shiftName: string;
  shiftDays: string;
  shiftHours: string;
  expectedPay: string;
  branchName: string;
  branchAddress: string;
};

type OutboxRow = {
  id: string;
  application_id: string;
  recipient_email: string;
  locale: ConfirmationLocale;
  payload: ConfirmationPayload;
  attempts: number;
};

const esc = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const safeError = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error ?? "Unknown email error");
  return raw.replace(/(token|authorization|api[-_ ]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]").slice(0, 1000);
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function fromAddress() {
  const email = requiredEnv("CAREER_GATE_FROM_EMAIL");
  const name = process.env.CAREER_GATE_FROM_NAME?.trim() || "Career Gate";
  return `${name} <${email}>`;
}

export function publicBaseUrl() {
  return requiredEnv("CAREER_GATE_PUBLIC_URL").replace(/\/+$/, "");
}

export function buildAbsoluteTrackingUrl(relativeOrAbsolute: string) {
  if (/^https?:\/\//i.test(relativeOrAbsolute)) return relativeOrAbsolute;
  return `${publicBaseUrl()}${relativeOrAbsolute.startsWith("/") ? "" : "/"}${relativeOrAbsolute}`;
}

function detailRow(label: string, value: string, rtl: boolean) {
  if (!value) return "";
  return `<tr>
    <td style="padding:10px 0;color:#9EB0C4;font-size:12px;font-weight:700;letter-spacing:.04em;vertical-align:top;${rtl ? "text-align:right" : "text-align:left"}">${esc(label)}</td>
    <td style="padding:10px 0;color:#F6F8FB;font-size:14px;font-weight:700;vertical-align:top;${rtl ? "text-align:left" : "text-align:right"}" dir="auto">${esc(value)}</td>
  </tr>`;
}

export function renderConfirmationEmail(locale: ConfirmationLocale, p: ConfirmationPayload) {
  const ar = locale === "ar";
  const dir = ar ? "rtl" : "ltr";
  const subject = ar
    ? `Career Gate — تم استلام طلبك — ${p.caseNumber}`
    : `Career Gate — Application Received — ${p.caseNumber}`;
  const preheader = ar
    ? "تم استلام طلبك بنجاح ويمكنك متابعة حالة ملفك مباشرة."
    : "Your Career Gate application has been successfully received.";
  const submittedLabel = ar ? "تاريخ الإرسال" : "SUBMITTED";
  const statusLabel = ar ? "الحالة" : "STATUS";
  const received = ar ? "تم استلام طلبك بنجاح" : "APPLICATION RECEIVED";
  const receivedStatus = ar ? "تم استلام الطلب" : "Application Received";
  const detailsTitle = ar ? "تفاصيل الطلب" : "APPLICATION DETAILS";
  const ctaTitle = ar ? "حالة الملف" : "CASE STATUS";
  const ctaMessage = ar ? "تابع حالة ملفك في أي وقت." : "Check your case status anytime.";
  const ctaText = ar ? "اضغط هنا لمتابعة حالة ملفك" : "CHECK YOUR CASE STATUS";
  const keep = ar ? "احتفظ برقم الملف للمتابعة والمراسلات." : "Keep your case number for future reference.";

  const rows = [
    detailRow(ar ? "الخدمة" : "SERVICE", p.service, ar),
    detailRow(ar ? "البريد الإلكتروني" : "EMAIL", p.email, ar),
    detailRow(ar ? "رقم الهاتف" : "PHONE", p.phone, ar),
    detailRow(ar ? "نوع الدوام" : "WORK TYPE", p.workType, ar),
    detailRow(ar ? "الشفت" : "SHIFT", p.shiftName, ar),
    detailRow(ar ? "أيام الشفت" : "SHIFT DAYS", p.shiftDays, ar),
    detailRow(ar ? "ساعات الشفت" : "SHIFT HOURS", p.shiftHours, ar),
    detailRow(ar ? "الأجر المتوقع" : "EXPECTED PAY", p.expectedPay, ar),
    detailRow(ar ? "موقع العمل" : "WORK LOCATION", p.branchName, ar),
    detailRow(ar ? "عنوان الموقع" : "LOCATION ADDRESS", p.branchAddress, ar),
  ].join("");

  const text = ar
    ? `Career Gate\nتم استلام طلبك بنجاح\n${p.clientName}\nرقم الملف: ${p.caseNumber}\nتاريخ الإرسال: ${p.submittedAt}\nمتابعة الملف: ${p.trackingUrl}\n\nWhatsApp: 313-919-4292\nPhone: 313-339-3566\nEmail: careergate.official@gmail.com`
    : `Career Gate\nApplication received successfully\n${p.clientName}\nCase number: ${p.caseNumber}\nSubmitted: ${p.submittedAt}\nTrack your case: ${p.trackingUrl}\n\nWhatsApp: 313-919-4292\nPhone: 313-339-3566\nEmail: careergate.official@gmail.com`;

  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07101F;font-family:Arial,'Segoe UI',Tahoma,sans-serif;color:#F6F8FB;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#07101F;margin:0;padding:0;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#0D1B2E;border:1px solid rgba(214,179,74,.32);border-radius:24px;overflow:hidden;">
<tr><td style="padding:22px 24px;border-bottom:1px solid #20344D;">
  <table role="presentation" width="100%"><tr>
    <td style="font-size:13px;font-weight:800;color:#F2D981;${ar ? "text-align:right" : "text-align:left"}">ALHIJRAH SERVICES</td>
    <td style="font-size:15px;font-weight:900;color:#F6F8FB;${ar ? "text-align:left" : "text-align:right"}">CAREER GATE</td>
  </tr></table>
</td></tr>
<tr><td style="padding:30px 24px 14px;text-align:center;">
  <div style="font-size:13px;font-weight:900;letter-spacing:.08em;color:#4AC394">✓ ${esc(received)}</div>
  <div style="margin-top:12px;font-size:24px;line-height:1.35;font-weight:900;color:#F6F8FB" dir="auto">${esc(p.clientName)}</div>
  <div style="margin-top:22px;font-size:12px;font-weight:800;color:#9EB0C4">${ar ? "رقم الملف" : "CASE NUMBER"}</div>
  <div style="margin-top:6px;font-family:Consolas,'Courier New',monospace;font-size:25px;font-weight:900;color:#F2D981;letter-spacing:.03em" dir="ltr">${esc(p.caseNumber)}</div>
</td></tr>
<tr><td style="padding:14px 24px 24px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#13243A;border-radius:16px;padding:8px 16px;">
    ${detailRow(submittedLabel, p.submittedAt, ar)}
    ${detailRow(statusLabel, receivedStatus, ar)}
  </table>
</td></tr>
<tr><td style="padding:0 24px 24px;">
  <div style="font-size:12px;font-weight:900;letter-spacing:.08em;color:#D6B34A;margin-bottom:10px;${ar ? "text-align:right" : "text-align:left"}">${esc(detailsTitle)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#13243A;border-radius:16px;padding:8px 16px;">${rows}</table>
</td></tr>
<tr><td style="padding:0 24px 24px;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#10283A;border:1px solid #45D7DD;border-radius:18px;">
    <tr><td style="padding:24px;text-align:center;">
      <div style="font-size:12px;font-weight:900;letter-spacing:.12em;color:#45D7DD">${esc(ctaTitle)}</div>
      <div style="margin-top:9px;font-size:16px;font-weight:800;color:#F6F8FB">${esc(ctaMessage)}</div>
      <div style="margin:8px 0 20px;font-family:Consolas,'Courier New',monospace;font-size:16px;font-weight:900;color:#F2D981" dir="ltr">${esc(p.caseNumber)}</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" bgcolor="#45D7DD" style="border-radius:12px;">
        <a href="${esc(p.trackingUrl)}" target="_blank" style="display:block;min-height:52px;line-height:52px;padding:0 18px;background:#45D7DD;border-radius:12px;color:#07101F;text-decoration:none;font-size:14px;font-weight:900;text-align:center">${esc(ctaText)}</a>
      </td></tr></table>
    </td></tr>
  </table>
</td></tr>
<tr><td style="padding:20px 24px 26px;border-top:1px solid #20344D;text-align:center;">
  <div style="font-size:13px;line-height:1.7;color:#9EB0C4">${esc(keep)}</div>
  <div style="margin-top:14px;font-size:12px;line-height:1.8;color:#F6F8FB" dir="ltr">WhatsApp: 313-919-4292<br>Phone: 313-339-3566<br>Email: careergate.official@gmail.com</div>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject, html, text, preheader };
}

async function sendPostmark(row: OutboxRow) {
  const token = requiredEnv("POSTMARK_SERVER_TOKEN");
  const rendered = renderConfirmationEmail(row.locale, row.payload);
  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Postmark-Server-Token": token,
    },
    body: JSON.stringify({
      From: fromAddress(),
      To: row.recipient_email,
      Subject: rendered.subject,
      HtmlBody: rendered.html,
      TextBody: rendered.text,
      MessageStream: "outbound",
      Tag: PUBLIC_INTAKE_CONFIRMATION_TEMPLATE,
      Metadata: { outbox_id: row.id, application_id: row.application_id },
    }),
    signal: AbortSignal.timeout(15000),
  });
  const json = await response.json().catch(() => ({})) as { MessageID?: string; Message?: string; ErrorCode?: number };
  if (!response.ok || !json.MessageID || (json.ErrorCode ?? 0) !== 0) {
    throw new Error(`Postmark send failed: ${json.Message || response.statusText || response.status}`);
  }
  return json.MessageID;
}

async function processOneOutbox(outboxId: string) {
  const db = sql();
  return db.begin(async (tx) => {
    const rows = await tx<OutboxRow[]>`
      select id, application_id, recipient_email, locale, payload, attempts
      from career_gate_email_outbox
      where id = ${outboxId}
        and status = 'pending'
        and attempts < 8
      for update skip locked
    `;
    const row = rows[0];
    if (!row) return { processed: false, sent: false };
    try {
      const messageId = await sendPostmark(row);
      await tx`
        update career_gate_email_outbox
        set status = 'sent', attempts = attempts + 1, provider_message_id = ${messageId},
            last_error = null, sent_at = now()
        where id = ${row.id}
      `;
      return { processed: true, sent: true, messageId };
    } catch (error) {
      await tx`
        update career_gate_email_outbox
        set status = 'pending', attempts = attempts + 1, last_error = ${safeError(error)}
        where id = ${row.id}
      `;
      return { processed: true, sent: false, error: safeError(error) };
    }
  });
}

export async function processPendingConfirmationEmails(limit = 20, applicationId?: string) {
  const db = sql();
  const ids = applicationId
    ? await db<{ id: string }[]>`
        select id from career_gate_email_outbox
        where application_id = ${applicationId}
          and template_key = ${PUBLIC_INTAKE_CONFIRMATION_TEMPLATE}
          and status = 'pending' and attempts < 8
        order by created_at asc limit 1
      `
    : await db<{ id: string }[]>`
        select id from career_gate_email_outbox
        where template_key = ${PUBLIC_INTAKE_CONFIRMATION_TEMPLATE}
          and status = 'pending' and attempts < 8
        order by created_at asc limit ${limit}
      `;
  const results = [];
  for (const item of ids) results.push(await processOneOutbox(item.id));
  return results;
}

export async function recordPostmarkEvent(messageId: string, event: "delivered" | "bounced", detail?: string) {
  const db = sql();
  if (event === "delivered") {
    const rows = await db`
      update career_gate_email_outbox
      set status = 'delivered', delivered_at = coalesce(delivered_at, now()), last_error = null
      where provider_message_id = ${messageId}
      returning id
    `;
    return rows.length > 0;
  }
  const rows = await db`
    update career_gate_email_outbox
    set status = 'bounced', last_error = ${detail ? detail.slice(0, 1000) : "Postmark bounce"}
    where provider_message_id = ${messageId}
    returning id
  `;
  return rows.length > 0;
}
