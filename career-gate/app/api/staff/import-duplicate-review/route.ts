import { z } from "zod";
import { staffGuard } from "@/lib/staff-api";
import { traceIdFrom } from "@/lib/obs";
import { dbErrorResponse, err, ok } from "@/lib/http";
import { ActionError } from "@/lib/service";
import { ImportReviewRequest } from "@/lib/import-duplicate-contract";
import { mutateImportReview, readImportReview } from "@/lib/import-duplicate-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function privateResponse(response: Response) { response.headers.set("Cache-Control", "private, no-store"); return response; }
function failure(cause: unknown, trace: string) {
  if (cause instanceof ActionError) return err(cause.code, cause.message, cause.status, trace);
  if (cause instanceof z.ZodError) return err("invalid_input", "Choose a valid file and review option", 400, trace);
  return dbErrorResponse(cause, trace);
}
export async function GET(req: Request) {
  const trace = traceIdFrom(req), guard = await staffGuard(req, trace, { mutation: false });
  if (guard.response) return privateResponse(guard.response);
  try {
    const p = new URL(req.url).searchParams;
    const mode = z.enum(["queue", "scan", "trash"]).parse(p.get("mode") ?? "queue");
    const input = mode === "scan" ? { case_id: z.uuid().parse(p.get("case_id")) }
      : { q: (p.get("q") ?? "").slice(0, 100), page: z.coerce.number().int().min(1).max(100000).parse(p.get("page") ?? "1") };
    return privateResponse(ok({ result: await readImportReview(guard.session, mode, input) }, 200, trace));
  } catch (cause) { return privateResponse(failure(cause, trace)); }
}
export async function POST(req: Request) {
  const trace = traceIdFrom(req), guard = await staffGuard(req, trace, { mutation: true });
  if (guard.response) return privateResponse(guard.response);
  try {
    const input = ImportReviewRequest.parse(await req.json().catch(() => null));
    return privateResponse(ok({ result: await mutateImportReview(guard.session, input, trace) }, 200, trace));
  } catch (cause) { return privateResponse(failure(cause, trace)); }
}
