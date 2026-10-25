import { getStaffSession } from "@/lib/auth";
import { parseFieldVital } from "@/lib/field-vitals";
import { err } from "@/lib/http";
import { log, traceIdFrom } from "@/lib/obs";

export const runtime = "nodejs";

/**
 * Field Web Vitals beacon from signed-in staff pages. Writes one structured log
 * line (event "web_vital") and nothing to the database. The staff id is not
 * logged: the figures describe the page and the device class, not the person.
 */
export async function POST(req: Request) {
  const traceId = traceIdFrom(req);
  if (!(await getStaffSession())) return err("unauthorized", "Sign in required", 401, traceId);
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > 2048) return err("validation", "Report too large", 413, traceId);
  const text = await req.text();
  if (text.length > 2048) return err("validation", "Report too large", 413, traceId);
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const vital = parseFieldVital(body);
  if (!vital) return err("validation", "Invalid report", 400, traceId);
  log("info", { event: "web_vital", trace_id: traceId, ...vital });
  return new Response(null, { status: 204 });
}
