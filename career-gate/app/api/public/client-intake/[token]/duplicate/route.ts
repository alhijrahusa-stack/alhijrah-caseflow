import { err, ok } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";
import { readIntakeLinkForClient } from "@/lib/client-intake-link";
import { findPublicDuplicate } from "@/lib/public-intake-duplicate";

export const runtime = "nodejs";

export async function POST(req: Request, context: { params: Promise<{ token: string }> }) {
  const traceId = traceIdFrom(req);
  const { token } = await context.params;
  const open = await readIntakeLinkForClient(token);
  if (!open.ok) {
    return err(open.reason === "not_found" ? "not_found" : "link_closed", "This link is not available.", open.reason === "not_found" ? 404 : 410, traceId);
  }

  const body = await req.json().catch(() => null) as {
    email?: unknown;
    caseNumber?: unknown;
    fullName?: unknown;
    dateOfBirth?: unknown;
    phone?: unknown;
  } | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const caseNumber = typeof body?.caseNumber === "string" ? body.caseNumber.trim().toUpperCase() : "";
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const dateOfBirth = typeof body?.dateOfBirth === "string" ? body.dateOfBirth.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";

  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null;
  const validCase = /^CG-[0-9]{4}-[0-9]{6}$/.test(caseNumber) ? caseNumber : null;
  if (!validEmail && !validCase) return ok({ duplicate: false }, 200, traceId);

  const match = await findPublicDuplicate({
    email: validEmail,
    caseNumber: validCase,
    fullName,
    dateOfBirth,
    phone,
  });
  // Never disclose an existing case number from an unauthenticated email probe.
  return ok({ duplicate: match.exists }, 200, traceId);
}
