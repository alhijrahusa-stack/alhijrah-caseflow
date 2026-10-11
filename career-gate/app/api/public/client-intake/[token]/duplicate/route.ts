import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { readIntakeLinkForClient } from "@/lib/client-intake-link";
import { findPublicDuplicateByEmail } from "@/lib/public-intake-duplicate";

export const runtime = "nodejs";

export async function POST(req: Request, context: { params: Promise<{ token: string }> }) {
  const traceId = traceIdFrom(req);
  const { token } = await context.params;
  const open = await readIntakeLinkForClient(token);
  if (!open.ok) {
    return err(open.reason === "not_found" ? "not_found" : "link_closed", "This link is not available.", open.reason === "not_found" ? 404 : 410, traceId);
  }

  const body = await req.json().catch(() => null) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return ok({ duplicate: false }, 200, traceId);
  }

  const match = await findPublicDuplicateByEmail(email);
  // Never disclose an existing case number from an unauthenticated email probe.
  return ok({ duplicate: match.exists }, 200, traceId);
}
