import { z } from "zod";
import { err, ok } from "@/lib/http";
import { operationsClient } from "@/lib/operations";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId);
  if (guard.response) return guard.response;
  const raw = new URL(req.url).searchParams.get("client_id");
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) return err("invalid_input", "Valid client_id is required", 400, traceId);
  const client = await operationsClient(guard.session, parsed.data);
  if (!client) return err("not_found", "Client not found or not accessible", 404, traceId);
  return ok({ client }, 200, traceId);
}
