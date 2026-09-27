import { cookies } from "next/headers";
import { clearSessionCookies } from "@/lib/auth";
import { ok } from "@/lib/http";
import { ACCESS_COOKIE } from "@/lib/jwt";
import { signOut } from "@/lib/providers/supabase-auth";

export const runtime = "nodejs";

export async function POST() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (token) await signOut(token);
  await clearSessionCookies();
  return ok({ signed_out: true });
}
