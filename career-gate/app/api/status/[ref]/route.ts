import { err, ok } from "@/lib/http";
import { publicStatusByIdentifier } from "@/lib/public-status";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const { ref } = await ctx.params;
  const r = decodeURIComponent(ref).trim();
  const s = await publicStatusByIdentifier(r);
  if (!s) return err("not_found", "File not found", 404);
  return ok({ status: s });
}
