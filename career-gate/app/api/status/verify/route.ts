import { err } from "@/lib/http";
import { traceIdFrom } from "@/lib/obs";

export const runtime = "nodejs";

/** Public status is direct lookup; OTP verification is intentionally retired. */
export async function POST(req: Request) {
  return err("gone", "Status verification codes are no longer used. Check status directly with your file number, phone or email.", 410, traceIdFrom(req));
}
