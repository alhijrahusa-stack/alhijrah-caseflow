import { sql } from "@/lib/db";
import { verifyResendSignature } from "@/lib/providers/messaging";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const raw = await req.text();
  const ok = verifyResendSignature(raw, req.headers.get("svix-id"), req.headers.get("svix-timestamp"), req.headers.get("svix-signature"));
  if (!ok) return new Response("invalid signature", { status: 403 });
  const evt = JSON.parse(raw) as { type?: string; data?: { email_id?: string } };
  const id = evt.data?.email_id;
  if (id && evt.type === "email.delivered") await sql()`update notifications set status = 'delivered', delivered_at = now() where provider = 'resend' and provider_id = ${id}`;
  if (id && (evt.type === "email.bounced" || evt.type === "email.failed")) await sql()`update notifications set status = 'failed', error = ${`resend: ${evt.type}`} where provider = 'resend' and provider_id = ${id}`;
  return new Response(null, { status: 204 });
}
