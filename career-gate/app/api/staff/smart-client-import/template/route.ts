import { err } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { staffGuard } from "@/lib/staff-api";
import { buildCareerGateImportTemplate } from "@/lib/smart-client-template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const guard = await staffGuard(req, traceId, { mutation: false });
  if (guard.response) return guard.response;
  if (guard.session.staff.role === "staff") return err("forbidden", "Smart client import requires manager or admin access", 403, traceId);
  const workbook = buildCareerGateImportTemplate();
  return new Response(workbook, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": "attachment; filename=\"Career-Gate-Client-Import.xlsx\"",
      "Cache-Control": "private, no-store",
      "Content-Length": String(workbook.length),
    },
  });
}
