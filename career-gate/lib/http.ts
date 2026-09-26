import "server-only";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_COOKIE, verifyCookie } from "@/lib/staff-access";

export type ApiError = { ok: false; error: { code: string; message: string } };

export function ok<T extends object>(data: T, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

export function err(code: string, message: string, status = 400) {
  return NextResponse.json({ ok: false, error: { code, message } } satisfies ApiError, { status });
}

/** Defense in depth: middleware already gates /staff and /api/staff. */
export async function staffAllowed() {
  const jar = await cookies();
  return verifyCookie(jar.get(STAFF_COOKIE)?.value);
}

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}

/** Postgres constraint violations become 400s instead of opaque 500s. */
export function dbErrorResponse(e: unknown) {
  const code = (e as { code?: string })?.code;
  if (code === "23505") return err("conflict", "That record already exists", 409);
  if (code === "23514" || code === "22P02" || code === "22007" || code === "22008") {
    return err("invalid_input", "A value was rejected by the database constraints", 400);
  }
  if (code === "23503") return err("invalid_reference", "A referenced record does not exist", 400);
  console.error(e);
  return err("server_error", "The server could not complete the request", 500);
}
