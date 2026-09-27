import { sql } from "@/lib/db";
import { registry } from "@/lib/providers/config";
import { verifyMetaSignature } from "@/lib/providers/messaging";

export const runtime = "nodejs";

/** WhatsApp Cloud API webhook verification handshake. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const token = registry.whatsapp().verifyToken;
  if (!token) return new Response("NOT_CONFIGURED", { status: 503 });
  if (sp.get("hub.mode") === "subscribe" && sp.get("hub.verify_token") === token) return new Response(sp.get("hub.challenge") ?? "", { status: 200 });
  return new Response("forbidden", { status: 403 });
}

/** Delivery statuses, accepted only with a valid X-Hub-Signature-256. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("invalid signature", { status: 403 });
  const body = JSON.parse(raw) as { entry?: { changes?: { value?: { statuses?: { id: string; status: string }[] } }[] }[] };
  for (const e of body.entry ?? []) for (const c of e.changes ?? []) for (const st of c.value?.statuses ?? []) {
    if (st.status === "delivered" || st.status === "read") {
      await sql()`update notifications set status = 'delivered', delivered_at = coalesce(delivered_at, now()) where provider = 'meta_whatsapp' and provider_id = ${st.id}`;
    } else if (st.status === "failed") {
      await sql()`update notifications set status = 'failed', error = 'meta: failed' where provider = 'meta_whatsapp' and provider_id = ${st.id}`;
    }
  }
  return new Response(null, { status: 200 });
}
