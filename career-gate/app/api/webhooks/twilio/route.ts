import { sql } from "@/lib/db";
import { verifyTwilioSignature } from "@/lib/providers/messaging";
import { registry } from "@/lib/providers/config";

export const runtime = "nodejs";

/** Twilio status callback: marks delivered/failed only on a valid signature. */
export async function POST(req: Request) {
  const base = registry.app().baseUrl;
  if (!base) return new Response("NOT_CONFIGURED", { status: 503 });
  const form = await req.formData();
  const params = Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
  if (!verifyTwilioSignature(`${base}/api/webhooks/twilio`, params, req.headers.get("x-twilio-signature"))) {
    return new Response("invalid signature", { status: 403 });
  }
  const sid = params.MessageSid;
  const s = params.MessageStatus;
  if (sid && s === "delivered") await sql()`update notifications set status = 'delivered', delivered_at = now() where provider = 'twilio' and provider_id = ${sid}`;
  if (sid && (s === "failed" || s === "undelivered")) await sql()`update notifications set status = 'failed', error = ${`twilio: ${s}`} where provider = 'twilio' and provider_id = ${sid}`;
  return new Response(null, { status: 204 });
}
