import { gateJobErrorResponse } from "@/lib/gate-job-account/api";
import { addGateJobEmail, deleteGateJobEmail, getGateJobVault, updateGateJobEmail } from "@/lib/gate-job-account/service";
import { DeleteGateJobEmailSchema } from "@/lib/gate-job-account/validation";
import { ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";
import type { VaultStatus } from "@/lib/gate-job-account/repository";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return guard.response;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 160);
  const rawStatus = (url.searchParams.get("status") ?? "ALL").toUpperCase();
  const status: VaultStatus | "ALL" = ["AVAILABLE", "RESERVED", "USED"].includes(rawStatus) ? rawStatus as VaultStatus : "ALL";
  try {
    return ok(await getGateJobVault(guard.session, q, status, traceId), 200, traceId);
  } catch (error) {
    return gateJobErrorResponse(error, traceId);
  }
}

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  try {
    const email = await addGateJobEmail(guard.session, await req.json().catch(() => undefined), traceId);
    return ok({ email }, 201, traceId);
  } catch (error) {
    return gateJobErrorResponse(error, traceId);
  }
}

export async function PATCH(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  try {
    const email = await updateGateJobEmail(guard.session, await req.json().catch(() => undefined), traceId);
    return ok({ email }, 200, traceId);
  } catch (error) {
    return gateJobErrorResponse(error, traceId);
  }
}

export async function DELETE(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  try {
    const { id } = DeleteGateJobEmailSchema.parse(await req.json().catch(() => undefined));
    return ok(await deleteGateJobEmail(guard.session, id, traceId), 200, traceId);
  } catch (error) {
    return gateJobErrorResponse(error, traceId);
  }
}
