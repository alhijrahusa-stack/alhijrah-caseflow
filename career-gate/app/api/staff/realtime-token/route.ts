import { cookies } from "next/headers";
import { err, ok } from "@/lib/http";
import { ACCESS_COOKIE } from "@/lib/jwt";
import { traceIdFrom } from "@/lib/obs";
import { registry } from "@/lib/providers/config";
import { staffGuard } from "@/lib/staff-api";

export const runtime = "nodejs";

/**
 * Hands the signed-in staff member's own short-lived access token to the
 * browser for Realtime, which applies RLS to what it streams.
 */
export async function GET(req: Request) {
  const traceId = traceIdFrom(req);
  const g = await staffGuard(req, traceId, { mutation: false });
  if (g.response) return g.response;
  const s = registry.supabase();
  if (!s.url || !s.anonKey) return err("NOT_CONFIGURED", "Realtime is NOT_CONFIGURED", 503, traceId);
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  return ok({ token, url: s.url, anon_key: s.anonKey }, 200, traceId);
}
