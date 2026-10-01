import { timingSafeEqual } from "node:crypto";
import { recordPostmarkEvent } from "@/lib/email/postmark";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function configuredSecret() {
  const value = process.env.POSTMARK_WEBHOOK_SECRET?.trim();
  return value || null;
}

function authorized(req: Request, secret: string) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = `Bearer ${secret}`;
  const basic = `Basic ${Buffer.from(`career-gate:${secret}`).toString("base64")}`;
  for (const expected of [bearer, basic]) {
    if (auth.length === expected.length && timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) return true;
  }
  return false;
}

type PostmarkWebhook = {
  RecordType?: string;
  MessageID?: string;
  Description?: string;
  Details?: string;
  Type?: string;
  TypeCode?: number;
};

export async function POST(req: Request) {
  const secret = configuredSecret();
  if (!secret) return NextResponse.json({ ok: false, error: "NOT_CONFIGURED" }, { status: 503 });
  if (!authorized(req, secret)) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });

  const body = await req.json().catch(() => null) as PostmarkWebhook | null;
  const messageId = body?.MessageID?.trim();
  const recordType = body?.RecordType?.trim().toLowerCase();
  if (!messageId || !recordType) return NextResponse.json({ ok: false, error: "INVALID_EVENT" }, { status: 400 });

  if (recordType === "delivery") {
    const updated = await recordPostmarkEvent(messageId, "delivered");
    return NextResponse.json({ ok: true, updated });
  }
  if (recordType === "bounce") {
    const detail = [body?.Type, body?.Description, body?.Details].filter(Boolean).join(": ").slice(0, 1000);
    const updated = await recordPostmarkEvent(messageId, "bounced", detail);
    return NextResponse.json({ ok: true, updated });
  }
  return NextResponse.json({ ok: true, ignored: true });
}
