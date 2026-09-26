import { createHash } from "node:crypto";
import { z } from "zod";
import { options } from "@/lib/catalog";
import { sql } from "@/lib/db";
import { clientIp, dbErrorResponse, err, ok } from "@/lib/http";
import { ACCURACY_DISCLAIMER, AUTHORIZATION_TEXT, AUTHORIZATION_VERSION } from "@/lib/office";
import { issuesMessage, ProfileSchema, SelectionSchema } from "@/lib/schemas";
import { ActionError, insertClient, statusUrl } from "@/lib/service";

export const runtime = "nodejs";

const AUTH_TEXT_STORED = `${AUTHORIZATION_TEXT}\n\n${ACCURACY_DISCLAIMER}`;
const AUTH_SHA256 = createHash("sha256").update(AUTH_TEXT_STORED).digest("hex");

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

const IntakeSchema = z.object({
  idempotency_key: z.uuid(),
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

export async function POST(req: Request) {
  const body = await req.json().catch(() => undefined);
  const parsed = IntakeSchema.safeParse(body);
  if (!parsed.success) return err("invalid_input", issuesMessage(parsed.error));
  const d = parsed.data;

  if (options.length > 0 && d.primary.length === 0) {
    return err("invalid_preferences", "Select at least one primary shift");
  }
  if (norm(d.authorization.signature) !== norm(d.authorization.printed_name)) {
    return err("invalid_signature", "Type your full printed name as your signature");
  }

  const db = sql();
  const [existing] = await db`select ref, status_token from clients where idempotency_key = ${d.idempotency_key}`;
  if (existing) {
    const origin = new URL(req.url).origin;
    return ok({ ref: existing.ref, status_url: statusUrl(origin, existing.ref, existing.status_token), duplicate: true });
  }

  try {
    const client = await db.begin(async (tx) => {
      const c = await insertClient(tx, {
        source: "public",
        profile: d.profile,
        primary: d.primary,
        backup: d.backup,
        status: "new_intake",
        nextStep: null,
        handledBy: null,
        communicationConsent: d.communication_consent,
        idempotencyKey: d.idempotency_key,
      });
      // signed_at defaults to the database clock; the browser's time is never used.
      await tx`
        insert into client_authorizations (
          client_id, authorization_version, authorization_text, authorization_sha256,
          printed_name, signature, communication_consent, ip_address, user_agent
        ) values (
          ${c.id}, ${AUTHORIZATION_VERSION}, ${AUTH_TEXT_STORED}, ${AUTH_SHA256},
          ${d.authorization.printed_name}, ${d.authorization.signature}, ${d.communication_consent},
          ${clientIp(req)}, ${req.headers.get("user-agent")?.slice(0, 300) ?? null}
        )`;
      return c;
    });
    const origin = new URL(req.url).origin;
    return ok(
      { ref: client.ref, status_url: statusUrl(origin, client.ref, client.status_token), upload_token: client.status_token },
      201,
    );
  } catch (e) {
    if (e instanceof ActionError) return err(e.code, e.message, e.status);
    // A concurrent retry with the same key won the race; return its result.
    if ((e as { code?: string }).code === "23505") {
      const [row] = await db`select ref, status_token from clients where idempotency_key = ${d.idempotency_key}`;
      if (row) return ok({ ref: row.ref, status_url: statusUrl(new URL(req.url).origin, row.ref, row.status_token), duplicate: true });
    }
    return dbErrorResponse(e);
  }
}
