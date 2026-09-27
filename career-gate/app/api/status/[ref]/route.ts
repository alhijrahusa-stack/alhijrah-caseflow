import { err, ok } from "@/lib/http";
import { publicStatus } from "@/lib/public-status";
import { cookies } from "next/headers";
import { sessionClient, STATUS_COOKIE } from "@/lib/status-access";

export const runtime = "nodejs";

/** Session-gated JSON for polling the public status page. */
export async function GET(_req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const { ref } = await ctx.params;
  const r = decodeURIComponent(ref).toUpperCase();
  if (!/^CG-\d{4}-\d{6}$/.test(r)) return err("unauthorized", "Verify with a code first", 401);
  const clientId = await sessionClient(r, (await cookies()).get(STATUS_COOKIE)?.value);
  if (!clientId) return err("unauthorized", "Verify with a code first", 401);
  const s = await publicStatus(clientId);
  if (!s) return err("unauthorized", "Verify with a code first", 401);
  return ok({ status: s });
}
