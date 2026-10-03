import { cookies } from "next/headers";
import { err, ok } from "@/lib/http";
import { publicStatus } from "@/lib/public-status";
import { sessionClient, STATUS_COOKIE } from "@/lib/status-access";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const { ref } = await ctx.params;
  const r = decodeURIComponent(ref).trim().toUpperCase();
  const token = (await cookies()).get(STATUS_COOKIE)?.value;
  const clientId = await sessionClient(r, token);
  if (!clientId) return err("unauthorized", "Verification required", 401);
  const s = await publicStatus(clientId);
  if (!s) return err("not_found", "File not found", 404);
  return ok({ status: s });
}
