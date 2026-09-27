import { createHash } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { options } from "@/lib/catalog";
import { fingerprint, newSessionToken, sha256Hex } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { dbErrorResponse, err, ipHash, clientIp } from "@/lib/http";
import { claimKey, completeKey } from "@/lib/idempotency";
import { enqueue, processJobs } from "@/lib/jobs";
import { queueSubmissionNotifications } from "@/lib/notify";
import { observe, traceIdFrom } from "@/lib/obs";
import { ACCURACY_DISCLAIMER, AUTHORIZATION_TEXT, AUTHORIZATION_VERSION } from "@/lib/office";
import { hit, remaining, securityEvent } from "@/lib/ratelimit";
import { issuesMessage, ProfileSchema, SelectionSchema } from "@/lib/schemas";
import { ActionError, insertClient } from "@/lib/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const AUTH_TEXT_STORED = `${AUTHORIZATION_TEXT}\n\n${ACCURACY_DISCLAIMER}`;
const AUTH_SHA256 = createHash("sha256").update(AUTH_TEXT_STORED).digest("hex");
const OPERATION = "public_intake";
const UPLOAD_GRANT_SECONDS = 2 * 60 * 60;

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

const IntakeSchema = z.object({
  state: z.literal("MI"),
  profile: ProfileSchema,
  primary: z.array(SelectionSchema).max(20),
  backup: z.array(SelectionSchema).max(20),
  communication_consent: z.boolean(),
  authorization: z.object({
    version: z.literal(AUTHORIZATION_VERSION),
    accepted: z.literal(true, { message: "You must accept the authorization" }),
    accuracy_acknowledged: z.literal(true, { message: "You must acknowledge the accuracy statement" }),
    printed_name: z.string().trim().min(2, "Printed name is required").max(160),
    signature: z.string().trim().min(2, "Signature is required").max(160),
  }),
  // Honeypot: never shown to people.
  website: z.string().max(0).optional(),
});

async function uploadGrant(clientId: string) {
  const token = newSessionToken();
  await sql()`insert into upload_grants (client_id, token_hash, expires_at)
              values (${clientId}, ${sha256Hex(`upload:${token}`)}, ${new Date(Date.now() + UPLOAD_GRANT_SECONDS * 1000)})`;
  return token;
}

function respond(status: number, body: Record<string, unknown>, traceId: string) {
  return NextResponse.json({ ...body, trace_id: traceId }, { status });
}

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  return observe({ trace_id: traceId, route: "/api/intake", operation: "intake_submit" }, async () => {
    const key = req.headers.get("idempotency-key") ?? "";
    if (!/^[\w-]{16,200}$/.test(key)) return err("idempotency_key_required", "Idempotency-Key header is required", 400, traceId);

    const raw = await req.json().catch(() => undefined);
    const fp = fingerprint(raw ?? null);
    const db = sql();

    // Replay or conflict before spending rate-limit budget.
    const [existing] = await db`select request_fingerprint, state, response_body, status_code from idempotency_keys
                                where operation = ${OPERATION} and key = ${key}`;
    if (existing) {
      if (existing.request_fingerprint !== fp) return err("idempotency_conflict", "This Idempotency-Key was used with a different request", 409, traceId);
      if (existing.state === "completed") {
        const body = existing.response_body as Record<string, unknown>;
        const upload_token = body.client_id ? await uploadGrant(body.client_id as string) : undefined;
        return respond(existing.status_code, { ...body, client_id: undefined, upload_token, replayed: true }, traceId);
      }
    }

    const ip = ipHash(req);
    if (!(await hit("intake_attempt_hour", ip))) {
      await securityEvent({ event: "rate_limited_intake", ipHash: ip, route: "/api/intake", traceId });
      return err("rate_limited", "Too many submissions from this network. Try again later.", 429, traceId);
    }
    if ((await remaining("intake_accept_5min", ip)) <= 0) {
      return err("rate_limited", "A request was just submitted from this network. Please wait a few minutes.", 429, traceId);
    }

    const parsed = IntakeSchema.safeParse(raw);
    if (!parsed.success) return err("invalid_input", issuesMessage(parsed.error), 400, traceId);
    const d = parsed.data;
    if (options.length > 0 && d.primary.length === 0) return err("invalid_preferences", "Select at least one primary shift", 400, traceId);
    if (norm(d.authorization.signature) !== norm(d.authorization.printed_name)) {
      return err("invalid_signature", "Type your full printed name as your signature", 400, traceId);
    }

    try {
      const out = await db.begin(async (tx) => {
        const claim = await claimKey(tx, OPERATION, key, fp);
        if (claim.kind === "conflict") return { kind: "conflict" as const };
        if (claim.kind === "replay") return { kind: "replay" as const, status: claim.status, body: claim.body as Record<string, unknown> };

        const actor = { staffId: null, traceId };
        const c = await insertClient(tx, {
          source: "public_intake", profile: d.profile, primary: d.primary, backup: d.backup, status: "new_intake",
          nextStep: null, assignedStaff: null, createdBy: null, communicationConsent: d.communication_consent,
        }, actor);
        // signed_at is the database clock; the browser's time is never used.
        await tx`
          insert into client_authorizations (client_id, authorization_version, authorization_text, authorization_sha256,
            printed_name, signature, communication_consent, ip_address, user_agent)
          values (${c.id}, ${AUTHORIZATION_VERSION}, ${AUTH_TEXT_STORED}, ${AUTH_SHA256}, ${d.authorization.printed_name},
            ${d.authorization.signature}, ${d.communication_consent}, ${clientIp(req)}, ${req.headers.get("user-agent")?.slice(0, 300) ?? null})`;
        const notifications = await queueSubmissionNotifications(tx, {
          id: c.id, phone: d.profile.phone, email: d.profile.email, consent: d.communication_consent,
          payload: { first_name: d.profile.full_name.split(" ")[0], ref: c.ref, submitted_at: new Date(c.created_at).toISOString() },
        }, actor);
        await enqueue(tx, { type: "intake_analysis", entityId: c.id, dedupeKey: `intake:${c.id}`, traceId });
        await tx`select public.rate_limit_hit('intake_accept_5min', ${ip}, 300, 1)`;
        const body = { ok: true, ref: c.ref, status_url: "/status", submitted_at: new Date(c.created_at).toISOString(), notifications, client_id: c.id };
        await completeKey(tx, OPERATION, key, 201, body);
        return { kind: "new" as const, body };
      });

      if (out.kind === "conflict") return err("idempotency_conflict", "This Idempotency-Key was used with a different request", 409, traceId);
      const body = out.kind === "new" ? out.body : out.body;
      const upload_token = await uploadGrant(body.client_id as string);
      after(() => processJobs(10).catch((e) => console.error(e)));
      return respond(out.kind === "new" ? 201 : out.status, { ...body, client_id: undefined, upload_token, replayed: out.kind === "replay" }, traceId);
    } catch (e) {
      if (e instanceof ActionError) return err(e.code, e.message, e.status, traceId);
      return dbErrorResponse(e, traceId);
    }
  }, (res) => ({ result: res.status < 400 ? "ok" : "error", error_code: res.status < 400 ? null : String(res.status) }));
}
