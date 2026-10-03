import { amazonErrorResponse } from "@/lib/amazon/api";
import { getAmazonAccounts } from "@/lib/amazon/service";
import { ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";
import type { AccountStatus } from "@/lib/amazon/repository";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return guard.response;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 160);
  const rawStatus = (url.searchParams.get("status") ?? "ALL").toUpperCase();
  const status: AccountStatus | "ALL" = ["PENDING", "READY", "DISABLED"].includes(rawStatus) ? rawStatus as AccountStatus : "ALL";
  try {
    return ok({ accounts: await getAmazonAccounts(guard.session, q, status, traceId) }, 200, traceId);
  } catch (error) {
    return amazonErrorResponse(error, traceId);
  }
}
