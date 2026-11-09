import { permissionAllows } from "@/lib/authz";
import { ClientPriorityInput, executeClientPriority } from "@/lib/client-priority";
import { dbErrorResponse, err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { ActionError } from "@/lib/service";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function privateResponse(response: Response) { response.headers.set("Cache-Control", "private, no-store"); return response; }

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return privateResponse(guard.response);
  const parsed = ClientPriorityInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return privateResponse(err("invalid_input", "Choose a client, priority and current file version", 400, traceId));
  try {
    if (!await permissionAllows(guard.session, "update_client")) throw new ActionError("forbidden", "Client update permission required", 403);
    return privateResponse(ok(await executeClientPriority(guard.session, parsed.data, traceId), 200, traceId));
  } catch (error) {
    return privateResponse(error instanceof ActionError ? err(error.code, error.message, error.status, traceId) : dbErrorResponse(error, traceId));
  }
}
