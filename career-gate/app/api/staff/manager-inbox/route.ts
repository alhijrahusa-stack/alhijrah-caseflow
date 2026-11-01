import { z } from "zod";
import { CLIENT_STAGE_IDS } from "@/lib/client-lifecycle-filters";
import { LifecycleRoutingError } from "@/lib/client-lifecycle-routing";
import { dbErrorResponse, err, ok } from "@/lib/http";
import { managerInbox, resolveManagerReview, submitManagerReview, type ResolveManagerReview } from "@/lib/manager-inbox";
import { traceIdFrom } from "@/lib/obs";
import { ActionError } from "@/lib/service";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Submit = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("client"), client_id: z.uuid(), note: z.string().trim().max(4000).default(""), request_key: z.uuid() }),
  z.object({ kind: z.literal("report"), period: z.union([z.literal(7), z.literal(30), z.literal(90)]), note: z.string().trim().max(4000).default(""), request_key: z.uuid() }),
]);
const Resolve = z.object({
  id: z.uuid(), destination: z.string().refine(value => value === "keep_current" || CLIENT_STAGE_IDS.includes(value)),
  note: z.string().trim().max(2000).default(""), expected_client_version: z.string().min(10).max(100).nullable().optional(),
});
function failure(cause: unknown, traceId: string) {
  if (cause instanceof ActionError) return err(cause.code, cause.message, cause.status, traceId);
  if (cause instanceof LifecycleRoutingError) return err(cause.code, cause.message, 409, traceId);
  return dbErrorResponse(cause, traceId);
}
function privateResponse(response: Response) { response.headers.set("Cache-Control", "private, no-store"); return response; }

export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return privateResponse(guard.response);
  try { return privateResponse(ok({ inbox: await managerInbox(guard.session, Number(new URL(req.url).searchParams.get("page") || 1)) }, 200, traceId)); }
  catch (cause) { return privateResponse(failure(cause, traceId)); }
}
export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return privateResponse(guard.response);
  const input = Submit.safeParse(await req.json().catch(() => null));
  if (!input.success) return privateResponse(err("invalid_input", "Choose a valid client or report and provide a review note of at most 4,000 characters", 400, traceId));
  try { return privateResponse(ok(await submitManagerReview(guard.session, input.data, traceId), 200, traceId)); }
  catch (cause) { return privateResponse(failure(cause, traceId)); }
}
export async function PATCH(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return privateResponse(guard.response);
  const input = Resolve.safeParse(await req.json().catch(() => null));
  if (!input.success) return privateResponse(err("invalid_input", "Choose a valid destination and provide a note of at most 2,000 characters", 400, traceId));
  try { return privateResponse(ok(await resolveManagerReview(guard.session, input.data as ResolveManagerReview, traceId), 200, traceId)); }
  catch (cause) { return privateResponse(failure(cause, traceId)); }
}
