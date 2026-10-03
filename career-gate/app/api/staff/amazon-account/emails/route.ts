import { amazonErrorResponse } from "@/lib/amazon/api";
import { addAmazonEmail, deleteAmazonEmail, getAmazonVault, updateAmazonEmail } from "@/lib/amazon/service";
import { DeleteAmazonEmailSchema } from "@/lib/amazon/validation";
import { ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";
import type { VaultStatus } from "@/lib/amazon/repository";

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
    return ok(await getAmazonVault(guard.session, q, status, traceId), 200, traceId);
  } catch (error) {
    return amazonErrorResponse(error, traceId);
  }
}

export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  try {
    const email = await addAmazonEmail(guard.session, await req.json().catch(() => undefined), traceId);
    return ok({ email }, 201, traceId);
  } catch (error) {
    return amazonErrorResponse(error, traceId);
  }
}

export async function PATCH(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  try {
    const email = await updateAmazonEmail(guard.session, await req.json().catch(() => undefined), traceId);
    return ok({ email }, 200, traceId);
  } catch (error) {
    return amazonErrorResponse(error, traceId);
  }
}

export async function DELETE(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: true });
  if (guard.response) return guard.response;
  try {
    const { id } = DeleteAmazonEmailSchema.parse(await req.json().catch(() => undefined));
    return ok(await deleteAmazonEmail(guard.session, id, traceId), 200, traceId);
  } catch (error) {
    return amazonErrorResponse(error, traceId);
  }
}
