import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "@/lib/db";

const TEMPLATE_KEY = "public_intake_confirmation";
const MESSAGE_STREAM = "outbound";
const POSTMARK_API = "https://api.postmarkapp.com";
const MAX_ATTEMPTS = 5;

type Locale = "ar" | "en";

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
  locale: Locale;
  payload: ConfirmationPayload;
  attempts: number;
};

type PostmarkSendResult = {
  ErrorCode?: number;
  Message?: string;
  MessageID?: string;
  SubmittedAt?: string;
  To?: string;
};

declare global {
  var __careerGatePostmarkWebhookReady: boolean | undefined;
}

function requiredEnv(name: "POSTMARK_SERVER_TOKEN" | "CAREER_GATE_FROM_EMAIL" | "CAREER_GATE_PUBLIC_URL") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeBaseUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("CAREER_GATE_PUBLIC_URL must use HTTPS");
  return url.origin;
}

export function absoluteTrackingUrl(relativeOrAbsolute: string, caseNumber: string) {
  const base = normalizeBaseUrl(requiredEnv("CAREER_GATE_PUBLIC_URL"));
  if (relativeOrAbsolute) {
    const u = new URL(relativeOrAbsolute, base);
    if (u.origin !== base) throw new Error("Tracking URL must remain on CAREER_GATE_PUBLIC_URL");
    return u.toString();
  }
  const u = new URL("/career-gate.html", base);
  u.searchParams.set("track", "1");
  u.searchParams.set("case", caseNumber);
  return u.toString();
}

function formatSubmittedAt(iso: string, locale: Locale) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function detailRow(label: string, value: string, rtl: boolean) {
  if (!value) return "";
  return `<tr>
    <td style="padding:10px 0;color:#9EB0C4;font-size:13px;font-weight:700;vertical-align:top;${rtl ? "text-align:right" : "text-align:left"}">${escapeHtml(label)}</td>
    <td dir="auto" style="padding:10px 0;color:#F6F8FB;font-size:14px;font-weight:700;vertical-align:top;${rtl ? "text-align:left" : "text-align:right"}">${escapeHtml(value)}</td>
  </tr>`;
}

export function renderConfirmationEmail(locale: Locale, payload: ConfirmationPayload) {
  const rtl = locale === "ar";
  const tracking = absoluteTrackingUrl(payload.trackingUrl, payload.caseNumber);
  const submitted = formatSubmittedAt(payload.submittedAt, locale);
  const subject = rtl
    ? `Career Gate — تم استلام طلبك — ${payload.caseNumber}`
    : `Career Gate — Application Received — ${payload.caseNumber}`;
  const preheader = rtl
    ? "تم استلام طلبك بنجاح ويمكنك متابعة حالة ملفك مباشرة."
    : "Your Career Gate application has been successfully received.";
  const received = rtl ? "تم استلام طلبك بنجاح" : "APPLICATION RECEIVED";
  const caseLabel = rtl ? "رقم الملف" : "CASE NUMBER";
  const submittedLabel = rtl ? "وقت الإرسال" : "SUBMITTED";
  const statusLabel = rtl ? "الحالة" : "STATUS";
  const statusValue = rtl ? "تم استلام الطلب" : "Application Received";
  const detailsTitle = rtl ? "تفاصيل الطلب" : "APPLICATION DETAILS";
  const caseStatusLead = rtl ? "تابع حالة ملفك في أي وقت." : "Check your case status anytime.";
  const buttonText = rtl ? "اضغط هنا لمتابعة حالة ملفك" : "CHECK YOUR CASE STATUS";
  const keepCase = rtl
    ? "احتفظ برقم الملف للمتابعة والمراسلات."
    : "Keep your case number for future reference.";

  const rows = [
    detailRow(rtl ? "الخدمة" : "SERVICE", payload.service, rtl),
    detailRow(rtl ? "البريد الإلكتروني" : "EMAIL", payload.email, rtl),
    detailRow(rtl ? "رقم الهاتف" : "PHONE", payload.phone, rtl),
    detailRow(rtl ? "نوع الدوام" : "WORK TYPE", payload.workType, rtl),
    detailRow(rtl ? "الشفت" : "SHIFT", payload.shiftName, rtl),
    detailRow(rtl ? "أيام الشفت" : "SHIFT DAYS", payload.shiftDays, rtl),
    detailRow(rtl ? "ساعات الشفت" : "SHIFT HOURS", payload.shiftHours, rtl),
    detailRow(rtl ? "الأجر المتوقع" : "EXPECTED PAY", payload.expectedPay, rtl),
    detailRow(rtl ? "موقع العمل" : "WORK LOCATION", payload.branchName, rtl),
    detailRow(rtl ? "عنوان الموقع" : "SITE ADDRESS", payload.branchAddress, rtl),
  ].join("");

  const html = `<!doctype html>
<html lang="${locale}" dir="${rtl ? "rtl" : "ltr"}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#07101F;font-family:Arial,'Segoe UI',Tahoma,sans-serif;color:#F6F8FB;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#07101F;width:100%;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#0D1B2E;border:1px solid #203A53;border-radius:24px;overflow:hidden;">
        <tr><td style="padding:22px 24px;border-bottom:1px solid #203A53;">
          <table role="presentation" width="100%"><tr>
            <td style="color:#F2D981;font-size:13px;font-weight:800;letter-spacing:.08em;${rtl ? "text-align:right" : "text-align:left"}">ALHIJRAH SERVICES</td>
            <td style="color:#45D7DD;font-size:13px;font-weight:800;letter-spacing:.08em;${rtl ? "text-align:left" : "text-align:right"}">CAREER GATE</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:28px 24px 14px;${rtl ? "text-align:right" : "text-align:left"}">
          <div style="display:inline-block;padding:8px 12px;border-radius:999px;background:#103426;color:#7DE2B8;font-size:12px;font-weight:800;">✓ ${escapeHtml(received)}</div>
          <h1 dir="auto" style="margin:16px 0 8px;font-size:26px;line-height:1.25;color:#F6F8FB;">${escapeHtml(payload.clientName)}</h1>
        </td></tr>
        <tr><td style="padding:0 24px 18px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#13243A;border:1px solid #29445F;border-radius:16px;">
            <tr><td style="padding:18px;${rtl ? "text-align:right" : "text-align:left"}">
              <div style="color:#9EB0C4;font-size:12px;font-weight:800;letter-spacing:.08em;">${escapeHtml(caseLabel)}</div>
              <div dir="ltr" style="margin-top:7px;color:#F2D981;font-family:Consolas,'Courier New',monospace;font-size:22px;font-weight:800;letter-spacing:.02em;">${escapeHtml(payload.caseNumber)}</div>
              <div style="margin-top:14px;color:#9EB0C4;font-size:12px;font-weight:800;">${escapeHtml(submittedLabel)}</div>
              <div style="margin-top:5px;color:#F6F8FB;font-size:14px;font-weight:700;">${escapeHtml(submitted)}</div>
              <div style="margin-top:14px;color:#9EB0C4;font-size:12px;font-weight:800;">${escapeHtml(statusLabel)}</div>
              <div style="margin-top:5px;color:#4AC394;font-size:14px;font-weight:800;">${escapeHtml(statusValue)}</div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:4px 24px 20px;">
          <div style="color:#F2D981;font-size:13px;font-weight:800;letter-spacing:.08em;margin-bottom:8px;${rtl ? "text-align:right" : "text-align:left"}">${escapeHtml(detailsTitle)}</div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">${rows}</table>
        </td></tr>
        <tr><td style="padding:0 24px 24px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#10283A;border:1px solid #45D7DD;border-radius:18px;">
            <tr><td style="padding:22px;${rtl ? "text-align:right" : "text-align:left"}">
              <div style="color:#45D7DD;font-size:13px;font-weight:900;letter-spacing:.1em;">CASE STATUS</div>
              <div style="margin-top:8px;color:#F6F8FB;font-size:16px;font-weight:800;">${escapeHtml(caseStatusLead)}</div>
              <div style="margin-top:4px;color:#D9E1EA;font-size:14px;">${rtl ? "Check your case status anytime." : "تابع حالة ملفك في أي وقت."}</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:18px;"><tr><td bgcolor="#45D7DD" style="border-radius:12px;text-align:center;">
                <a href="${escapeHtml(tracking)}" target="_blank" style="display:block;min-height:52px;line-height:52px;padding:0 18px;background:#45D7DD;color:#07101F;text-decoration:none;border-radius:12px;font-size:15px;font-weight:900;">${escapeHtml(buttonText)}</a>
              </td></tr></table>
              <div dir="ltr" style="margin-top:14px;color:#F2D981;font-family:Consolas,'Courier New',monospace;font-size:14px;font-weight:800;">${escapeHtml(payload.caseNumber)}</div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 24px 26px;border-top:1px solid #203A53;${rtl ? "text-align:right" : "text-align:left"}">
          <div style="color:#D9E1EA;font-size:13px;line-height:1.7;">${escapeHtml(keepCase)}</div>
          <div dir="ltr" style="margin-top:14px;color:#9EB0C4;font-size:12px;line-height:1.8;${rtl ? "text-align:right" : "text-align:left"}">
            WhatsApp: 313-919-4292<br>Phone: 313-339-3566<br>Email: careergate.official@gmail.com
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = `${subject}\n\n${payload.clientName}\n${caseLabel}: ${payload.caseNumber}\n${submittedLabel}: ${submitted}\n${statusLabel}: ${statusValue}\n\n${detailsTitle}\n${payload.service}\n${payload.email}\n${payload.phone}\n${payload.workType}\n${payload.shiftName}\n${payload.shiftDays}\n${payload.shiftHours}\n${payload.expectedPay}\n${payload.branchName}\n${payload.branchAddress}\n\nCASE STATUS\n${caseStatusLead}\n${tracking}\n\n${keepCase}\nWhatsApp: 313-919-4292\nPhone: 313-339-3566\nEmail: careergate.official@gmail.com`;

  return { subject, preheader, html, text, trackingUrl: tracking };
}

function sanitizeError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error ?? "Unknown error");
  return raw.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").slice(0, 500);
}

async function postmarkFetch(path: string, init: RequestInit = {}) {
  const token = requiredEnv("POSTMARK_SERVER_TOKEN");
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  headers.set("X-Postmark-Server-Token", token);
  if (init.body) headers.set("Content-Type", "application/json");
  return fetch(`${POSTMARK_API}${path}`, { ...init, headers, cache: "no-store" });
}

function webhookSecret() {
  const token = requiredEnv("POSTMARK_SERVER_TOKEN");
  return createHash("sha256").update(`career-gate-postmark-webhook:${token}`).digest("hex");
}

export function verifyPostmarkWebhookSecret(received: string | null) {
  if (!received) return false;
  const expected = webhookSecret();
  if (received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}

export async function ensurePostmarkWebhook() {
  if (globalThis.__careerGatePostmarkWebhookReady) return true;
  const base = normalizeBaseUrl(requiredEnv("CAREER_GATE_PUBLIC_URL"));
  const webhookUrl = `${base}/api/webhooks/postmark`;
  const list = await postmarkFetch(`/webhooks?MessageStream=${encodeURIComponent(MESSAGE_STREAM)}`);
  if (!list.ok) throw new Error(`Postmark webhook list failed (${list.status})`);
  const data = await list.json() as { Webhooks?: Array<{ ID: number; Url: string; Status?: string }> };
  const existing = data.Webhooks?.find((w) => w.Url === webhookUrl);
  if (!existing) {
    const created = await postmarkFetch("/webhooks", {
      method: "POST",
      body: JSON.stringify({
        Url: webhookUrl,
        MessageStream: MESSAGE_STREAM,
        Verify: true,
        HttpHeaders: [{ Name: "X-Career-Gate-Webhook", Value: webhookSecret() }],
        Triggers: {
          Open: { Enabled: false, PostFirstOpenOnly: true },
          Click: { Enabled: false },
          Delivery: { Enabled: true },
          Bounce: { Enabled: true, IncludeContent: false },
          SpamComplaint: { Enabled: false, IncludeContent: false },
          SubscriptionChange: { Enabled: false },
        },
      }),
    });
    if (!created.ok) {
      const message = await created.text();
      throw new Error(`Postmark webhook create failed (${created.status}): ${message.slice(0, 240)}`);
    }
  }
  globalThis.__careerGatePostmarkWebhookReady = true;
  return true;
}

async function sendOutboxRow(row: OutboxRow) {
  const fromEmail = requiredEnv("CAREER_GATE_FROM_EMAIL");
  const fromName = process.env.CAREER_GATE_FROM_NAME?.trim() || "Career Gate";
  const rendered = renderConfirmationEmail(row.locale, row.payload);
  const response = await postmarkFetch("/email", {
    method: "POST",
    body: JSON.stringify({
      From: `${fromName} <${fromEmail}>`,
      To: row.recipient_email,
      Subject: rendered.subject,
      HtmlBody: rendered.html,
      TextBody: rendered.text,
      MessageStream: MESSAGE_STREAM,
      Tag: TEMPLATE_KEY,
      Metadata: {
        outbox_id: row.id,
        application_id: row.application_id,
        case_number: row.payload.caseNumber,
      },
    }),
  });
  const body = await response.json().catch(() => ({})) as PostmarkSendResult;
  if (!response.ok || body.ErrorCode) {
    throw new Error(body.Message || `Postmark send failed (${response.status})`);
  }
  if (!body.MessageID) throw new Error("Postmark response did not include MessageID");
  return body.MessageID;
}

export async function processEmailOutbox(limit = 10, caseNumber?: string) {
  if (!process.env.POSTMARK_SERVER_TOKEN || !process.env.CAREER_GATE_FROM_EMAIL || !process.env.CAREER_GATE_PUBLIC_URL) {
    return { configured: false, processed: 0, sent: 0, failed: 0 };
  }
  let processed = 0;
  let sent = 0;
  let failed = 0;
  const db = sql();

  for (let i = 0; i < Math.max(1, Math.min(limit, 50)); i++) {
    const result = await db.begin(async (tx) => {
      const rows = await tx<OutboxRow[]>`
        select o.id, o.application_id, o.recipient_email, o.locale, o.payload, o.attempts
        from career_gate_email_outbox o
        join career_gate_applications a on a.id = o.application_id
        where o.status = 'pending'
          and o.attempts < ${MAX_ATTEMPTS}
          and (${caseNumber ?? null}::text is null or a.case_number = ${caseNumber ?? null})
        order by o.created_at
        for update of o skip locked
        limit 1`;
      const row = rows[0];
      if (!row) return { found: false as const };
      try {
        const messageId = await sendOutboxRow(row);
        await tx`
          update career_gate_email_outbox
             set status = 'sent', provider_message_id = ${messageId}, sent_at = now(), attempts = attempts + 1, last_error = null
           where id = ${row.id}`;
        return { found: true as const, sent: true as const };
      } catch (error) {
        const message = sanitizeError(error);
        await tx`
          update career_gate_email_outbox
             set status = 'pending', attempts = attempts + 1, last_error = ${message}
           where id = ${row.id}`;
        return { found: true as const, sent: false as const };
      }
    });

    if (!result.found) break;
    processed += 1;
    if (result.sent) sent += 1;
    else failed += 1;
    if (caseNumber) break;
  }

  return { configured: true, processed, sent, failed };
}

export async function enqueueConfirmationEmail(args: {
  applicationId: string;
  recipientEmail: string;
  locale: Locale;
  payload: ConfirmationPayload;
}, tx: any) {
  await tx`
    insert into career_gate_email_outbox (application_id, template_key, recipient_email, locale, payload)
    values (${args.applicationId}, ${TEMPLATE_KEY}, ${args.recipientEmail.toLowerCase()}, ${args.locale}, ${tx.json(args.payload as never)})
    on conflict (application_id, template_key) do nothing`;
}

export const emailTemplateKey = TEMPLATE_KEY;
