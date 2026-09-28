import "server-only";
import { cookies } from "next/headers";
import type postgres from "postgres";
import { sql } from "@/lib/db";
import type { Role } from "@/lib/domain";
import { ACCESS_COOKIE, REFRESH_COOKIE, verifyAccessToken } from "@/lib/jwt";

export type AccessScope = "full" | "assigned_only";

export type StaffSession = {
  authUserId: string;
  staff: { id: string; display_name: string; email: string | null; role: Role; access_scope: AccessScope };
};

export type Tx = postgres.TransactionSql;

export async function staffFromAccessToken(token: string | undefined): Promise<StaffSession | null> {
  const claims = await verifyAccessToken(token);
  if (!claims) return null;
  const [staff] = await sql()`
    select id, display_name, email, role, access_scope from staff where auth_user_id = ${claims.sub} and active`;
  if (!staff) return null;
  return { authUserId: claims.sub, staff: staff as StaffSession["staff"] };
}

export async function getStaffSession(): Promise<StaffSession | null> {
  const jar = await cookies();
  return staffFromAccessToken(jar.get(ACCESS_COOKIE)?.value);
}

/**
 * Runs fn in a transaction as the Supabase `authenticated` role with the
 * caller's JWT subject, so row-level security applies to every statement.
 */
export async function withStaff<T>(session: StaffSession, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sql().begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: session.authUserId, role: "authenticated" })}, true)`;
    await tx.unsafe("set local role authenticated");
    return fn(tx);
  }) as Promise<T>;
}

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

export async function setSessionCookies(accessToken: string, refreshToken: string, expiresIn: number) {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, accessToken, sessionCookieOptions(expiresIn));
  jar.set(REFRESH_COOKIE, refreshToken, sessionCookieOptions(60 * 60 * 24 * 7));
}

export async function clearSessionCookies() {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

/** Links a verified Supabase Auth user only to a pre-approved active staff record. */
export async function resolveStaffForAuthUser(user: { id: string; email: string }) {
  const email = user.email.trim().toLowerCase();
  return sql().begin(async (tx) => {
    const [byId] = await tx`select id, active from staff where auth_user_id = ${user.id}`;
    if (byId) return byId.active ? (byId.id as string) : null;

    const [byEmail] = await tx`
      select id from staff
      where lower(email) = ${email} and active and auth_user_id is null
      for update`;
    if (!byEmail) return null;

    await tx`update staff set auth_user_id = ${user.id} where id = ${byEmail.id} and auth_user_id is null`;
    return byEmail.id as string;
  });
}
