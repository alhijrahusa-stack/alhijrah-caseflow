import { z } from "zod";
import { dbErrorResponse, err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { isPresenceWorkspaceSection, safeStaffPresencePath, type PresenceWorkspaceSection } from "@/lib/presence-model";
import { recordStaffPresence, teamPresenceRoster } from "@/lib/staff-presence";
import { ActionError } from "@/lib/service";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Input = z.object({ path: z.string().refine(path => safeStaffPresencePath(path) !== null), workspace_section: z.custom<PresenceWorkspaceSection>(isPresenceWorkspaceSection).nullable().optional(), state: z.enum(["active", "idle"]), visible: z.boolean() });
function privateResponse(response: Response) { response.headers.set("Cache-Control", "private, no-store"); return response; }
function failure(cause: unknown, traceId: string) {
  return cause instanceof ActionError ? err(cause.code, cause.message, cause.status, traceId) : dbErrorResponse(cause, traceId);
}
export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return privateResponse(guard.response);
  if (guard.session.staff.role !== "admin" && guard.session.staff.role !== "manager") return privateResponse(err("forbidden", "Team presence requires management access", 403, traceId));
  const requested = new URL(req.url).searchParams.get("clients");
  const clientIds = z.array(z.uuid()).max(64).safeParse(requested ? [...new Set(requested.split(","))] : []);
  if (!clientIds.success) return privateResponse(err("invalid_input", "Provide at most 64 valid client identifiers", 400, traceId));
  try { return privateResponse(ok({ ...await teamPresenceRoster(guard.session, clientIds.data), server_time: new Date().toISOString() }, 200, traceId)); }
  catch (cause) { return privateResponse(failure(cause, traceId)); }
}
export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return privateResponse(guard.response);
  const input = Input.safeParse(await req.json().catch(() => null));
  if (!input.success) return privateResponse(err("invalid_input", "Provide a valid workspace and presence state", 400, traceId));
  try { return privateResponse(ok({ presence: await recordStaffPresence(guard.session, input.data) }, 200, traceId)); }
  catch (cause) { return privateResponse(failure(cause, traceId)); }
}
