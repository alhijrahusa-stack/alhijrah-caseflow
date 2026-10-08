import { z } from "zod";
import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { ActionError } from "@/lib/service";
import { staffGuard } from "@/lib/staff-api";
import {
  INTAKE_LINK_DEFAULT_TTL_HOURS,
  INTAKE_LINK_MAX_TTL_HOURS,
  issueIntakeLink,
  listIntakeLinks,
  revokeIntakeLink,
} from "@/lib/client-intake-link";

export const runtime = "nodejs";

/**
 * Issues, lists and revokes one-time client intake links.
 *
 * The raw token is returned exactly once, in the URL of the POST response, and
 * is never stored, logged or returned again. Only its digest reaches the
 * database, so this endpoint cannot hand the same link back twice.
 */

const IssueInput = z.object({
  expires_in_hours: z.number().int().min(1).max(INTAKE_LINK_MAX_TTL_HOURS).optional(),
});

const RevokeInput = z.object({ link_id: z.uuid() });

/** The origin the client-facing link is built on. */
function publicOrigin(req: Request) {
  const configured = process.env.CAREER_GATE_PUBLIC_ORIGIN?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const url = new URL(req.url);
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const host = forwardedHost || url.host;
  const protocol = forwardedProto || url.protocol.replace(":", "");
  return `${protocol}://${host}`;
}

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  const parsed = IssueInput.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return err("invalid_input", parsed.error.issues[0]?.message ?? "Invalid request", 400, traceId);

  try {
    const link = await issueIntakeLink(guard.session, parsed.data.expires_in_hours ?? INTAKE_LINK_DEFAULT_TTL_HOURS);
    return ok(
      {
        id: link.id,
        url: `${publicOrigin(req)}/intake/${link.token}`,
        expires_at: link.expires_at,
        status: link.status,
      },
      201,
      traceId,
    );
  } catch (error) {
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    return err("intake_link_failed", "Could not create the client link", 500, traceId);
  }
}

export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return guard.response;
  try {
    return ok({ links: await listIntakeLinks(guard.session) }, 200, traceId);
  } catch (error) {
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    return err("intake_link_failed", "Could not read client links", 500, traceId);
  }
}

export async function DELETE(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  const parsed = RevokeInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return err("invalid_input", "A link_id is required", 400, traceId);

  try {
    return ok(await revokeIntakeLink(guard.session, parsed.data.link_id), 200, traceId);
  } catch (error) {
    if (error instanceof ActionError) return err(error.code, error.message, error.status, traceId);
    return err("intake_link_failed", "Could not revoke the client link", 500, traceId);
  }
}
