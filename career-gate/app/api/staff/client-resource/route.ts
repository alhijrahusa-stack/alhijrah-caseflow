import { clientScope } from "@/lib/authz";
import { clientAccountSummary } from "@/lib/client-account";
import { err, ok } from "@/lib/http";
import { clientNextAction } from "@/lib/next-action";
import { traceIdFrom } from "@/lib/obs";
import { clientFileSlices, parseClientFileSlices } from "@/lib/queries";
import { isDerivedPayload } from "@/lib/realtime-resources";
import { securityEvent } from "@/lib/ratelimit";
import { clientRequirements } from "@/lib/requirements";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PAYLOADS = 24;

/**
 * Scoped read for a targeted realtime update: returns only the payloads the
 * calling surface asked for, for one client.
 *
 * Authorization is unchanged and stays on the server -- the same session guard
 * and `clientScope` the client page itself runs. A caller can never widen its
 * scope by asking for more payloads; it can only ask for less work.
 */
export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: false });
  if (g.response) return g.response;

  const sp = new URL(req.url).searchParams;
  const clientId = sp.get("client_id") ?? "";
  if (!UUID.test(clientId)) return err("invalid_input", "Invalid client_id", 400, traceId);

  const requested = (sp.get("payloads") ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  if (requested.length === 0) return err("invalid_input", "No payloads requested", 400, traceId);
  if (requested.length > MAX_PAYLOADS) return err("invalid_input", "Too many payloads requested", 400, traceId);

  const scope = await clientScope(g.session, clientId);
  if (!scope.ok) {
    if (scope.status === 403) {
      await securityEvent({ event: "access_denied", staffId: g.session.staff.id, route: "/api/staff/client-resource", detail: { client_id: clientId } });
      return err("forbidden", "This client is not assigned to you", 403, traceId);
    }
    return err("not_found", "Client not found", 404, traceId);
  }

  const slices = parseClientFileSlices(requested);
  const derived = requested.filter(isDerivedPayload);
  if (slices.length === 0 && derived.length === 0) return err("invalid_input", "No known payloads requested", 400, traceId);

  const [sliceData, requirements, nextAction, account] = await Promise.all([
    clientFileSlices(g.session, clientId, slices),
    derived.includes("requirements") ? clientRequirements(g.session, clientId) : null,
    derived.includes("nextAction") ? clientNextAction(g.session, clientId) : null,
    derived.includes("account") ? clientAccountSummary(g.session, clientId) : null,
  ]);
  if (!sliceData) return err("not_found", "Client not found", 404, traceId);

  const payloads: Record<string, unknown> = { ...sliceData };
  if (requirements) {
    payloads.requirements = requirements.requirements;
    payloads.readiness = requirements.readiness;
  }
  if (derived.includes("nextAction")) payloads.nextAction = nextAction;
  if (derived.includes("account")) payloads.account = account;

  return ok({ client_id: clientId, payloads }, 200, traceId);
}
