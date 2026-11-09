import { confirmEmployment } from "@/lib/employment-registry";
import { EmploymentConfirmationInput } from "@/lib/employment-registry-schema";
import { dbErrorResponse, err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { ActionError } from "@/lib/service";
import { authorize, staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function privateResponse(response: Response) { response.headers.set("Cache-Control", "private, no-store"); return response; }

export async function POST(req: Request) {
  const trace = traceIdFrom(req), guard = await staffGuard(req, trace, { mutation: true });
  if (guard.response) return privateResponse(guard.response);
  const parsed = EmploymentConfirmationInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return privateResponse(err("invalid_input", parsed.error.issues[0]?.message ?? "Invalid employment confirmation", 400, trace));
  try {
    const permission = await authorize(req, guard.session, "update_client", { clientId: parsed.data.client_id }, trace);
    if (!permission.ok) return privateResponse(permission.response);
    return privateResponse(ok(await confirmEmployment(guard.session, parsed.data, trace), 200, trace));
  } catch (error) {
    return privateResponse(error instanceof ActionError ? err(error.code, error.message, error.status, trace) : dbErrorResponse(error, trace));
  }
}
