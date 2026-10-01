import { z } from "zod";
import { sql } from "@/lib/db";
import { verifyPostmarkWebhookSecret } from "@/lib/email/postmark";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const Event = z.object({
  RecordType: z.string().min(1),
  MessageID: z.string().min(1),
  DeliveredAt: z.string().optional(),
  BouncedAt: z.string().optional(),
  Description: z.string().optional(),
}).passthrough();

function sanitized(value: string | undefined) {
  return (value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").slice(0, 500) || null;
}

export async function POST(req: Request) {
  if (!verifyPostmarkWebhookSecret(req.headers.get("x-career-gate-webhook"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const parsed = Event.safeParse(await req.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  const event = parsed.data;
  const db = sql();

  if (event.RecordType === "Delivery") {
    await db`
      update career_gate_email_outbox
         set status = 'delivered', delivered_at = coalesce(${event.DeliveredAt ?? null}::timestamptz, now()), last_error = null
       where provider_message_id = ${event.MessageID}`;
    return NextResponse.json({ ok: true });
  }

  if (event.RecordType === "Bounce") {
    await db`
      update career_gate_email_outbox
         set status = 'bounced', last_error = ${sanitized(event.Description)}
       where provider_message_id = ${event.MessageID}`;
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true, ignored: true });
}
