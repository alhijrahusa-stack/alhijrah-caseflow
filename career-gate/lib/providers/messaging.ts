import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { registry } from "./config";

export type SendResult =
  | { status: "sent"; provider: string; provider_id: string }
  | { status: "not_configured"; provider: string }
  | { status: "failed"; provider: string; error: string; retryable: boolean };

const e164 = (tenDigits: string) => `+1${tenDigits}`;

async function post(provider: string, url: string, init: RequestInit): Promise<{ res: Response; body: Record<string, unknown> } | SendResult> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { res, body };
  } catch (e) {
    return { status: "failed", provider, error: e instanceof Error ? e.message : "network error", retryable: true };
  }
}

export async function sendSms(toTenDigits: string, text: string): Promise<SendResult> {
  const { sid, token, from } = registry.twilio();
  if (!sid || !token || !from) return { status: "not_configured", provider: "twilio" };
  const r = await post("twilio", `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: e164(toTenDigits),
      From: from,
      Body: text,
      ...(registry.app().baseUrl ? { StatusCallback: `${registry.app().baseUrl}/api/webhooks/twilio` } : {}),
    }),
  });
  if ("status" in r) return r;
  if (!r.res.ok || typeof r.body.sid !== "string") {
    return { status: "failed", provider: "twilio", error: String(r.body.message ?? `HTTP ${r.res.status}`), retryable: r.res.status >= 500 || r.res.status === 429 };
  }
  return { status: "sent", provider: "twilio", provider_id: r.body.sid };
}

export async function sendWhatsAppTemplate(toTenDigits: string, template: string | null, params: string[]): Promise<SendResult> {
  const w = registry.whatsapp();
  if (!w.token || !w.phoneId || !w.apiVersion || !w.templateLang || !template) return { status: "not_configured", provider: "meta_whatsapp" };
  const r = await post("meta_whatsapp", `https://graph.facebook.com/${w.apiVersion}/${w.phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${w.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: `1${toTenDigits}`,
      type: "template",
      template: {
        name: template,
        language: { code: w.templateLang },
        components: params.length ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] : [],
      },
    }),
  });
  if ("status" in r) return r;
  const id = (r.body.messages as { id?: string }[] | undefined)?.[0]?.id;
  if (!r.res.ok || !id) {
    const msg = (r.body.error as { message?: string } | undefined)?.message ?? `HTTP ${r.res.status}`;
    return { status: "failed", provider: "meta_whatsapp", error: msg, retryable: r.res.status >= 500 || r.res.status === 429 };
  }
  return { status: "sent", provider: "meta_whatsapp", provider_id: id };
}

export async function sendEmail(to: string, subject: string, text: string): Promise<SendResult> {
  const { apiKey, from } = registry.resend();
  if (!apiKey || !from) return { status: "not_configured", provider: "resend" };
  const r = await post("resend", "https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, text }),
  });
  if ("status" in r) return r;
  if (!r.res.ok || typeof r.body.id !== "string") {
    return { status: "failed", provider: "resend", error: String(r.body.message ?? `HTTP ${r.res.status}`), retryable: r.res.status >= 500 || r.res.status === 429 };
  }
  return { status: "sent", provider: "resend", provider_id: r.body.id };
}

// ---- Webhook signature verification --------------------------------------

const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Twilio: base64(HMAC-SHA1(authToken, url + sorted key/value pairs)). */
export function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string | null) {
  const { token } = registry.twilio();
  if (!token || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return eq(createHmac("sha1", token).update(data).digest("base64"), signature);
}

/** Meta: X-Hub-Signature-256 = "sha256=" + hex(HMAC-SHA256(appSecret, rawBody)). */
export function verifyMetaSignature(rawBody: string, header: string | null) {
  const { appSecret } = registry.whatsapp();
  if (!appSecret || !header) return false;
  return eq(`sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`, header);
}

/** Resend (Svix): base64(HMAC-SHA256(base64decode(secret without whsec_), id.timestamp.body)). */
export function verifyResendSignature(rawBody: string, id: string | null, ts: string | null, sigHeader: string | null) {
  const { webhookSecret } = registry.resend();
  if (!webhookSecret || !id || !ts || !sigHeader) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = Buffer.from(webhookSecret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${rawBody}`).digest("base64");
  return sigHeader.split(" ").some((part) => eq(part.split(",")[1] ?? "", expected));
}
