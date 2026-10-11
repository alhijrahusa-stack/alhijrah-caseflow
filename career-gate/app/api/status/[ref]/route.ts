import { cookies } from "next/headers";
import { err, ok } from "@/lib/http";
import { publicImportStatus, publicStatus } from "@/lib/public-status";
import { sessionStatusSubject, STATUS_COOKIE } from "@/lib/status-access";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const { ref } = await ctx.params;
  const r = decodeURIComponent(ref).trim().toUpperCase();
  const token = (await cookies()).get(STATUS_COOKIE)?.value;
  const subject = await sessionStatusSubject(r, token);
  if (!clientId) return err("unauthorized", "Verification required", 401);
  const s = subject.clientId ? await publicStatus(subject.clientId) : subject.importCaseId ? await publicImportStatus(subject.importCaseId) : null;
  if (!s) return err("not_found", "File not found", 404);
  return ok({ status: s });
}
