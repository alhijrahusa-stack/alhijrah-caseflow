import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type postgres from "postgres";
import { sql } from "@/lib/db";
import type { Role } from "@/lib/domain";
import { ACCESS_COOKIE, REFRESH_COOKIE, verifyAccessToken } from "@/lib/jwt";

export type StaffSession = {
  authUserId: string;
  staff: { id: string; display_name: string; email: string | null; role: Role };
};

export type Tx = postgres.TransactionSql;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function staffFromAccessToken(token: string | undefined): Promise<StaffSession | null> {
  const claims = await verifyAccessToken(token);
  if (!claims || !UUID.test(claims.sub)) return null;
  // Runs on every staff request. The verified subject is a UUID, written as a literal so the
  // lookup is one round trip (a bind parameter costs an extra Describe trip with prepare: false).
  const [staff] = await sql().unsafe(
    `select id, display_name, email, role from staff where auth_user_id = '${claims.sub}' and active`);
  if (!staff) return null;
  return { authUserId: claims.sub, staff: staff as unknown as StaffSession["staff"] };
}

export const getStaffSession = cache(async (): Promise<StaffSession | null> => {
  const jar = await cookies();
  return staffFromAccessToken(jar.get(ACCESS_COOKIE)?.value);
});


/**
 * Runs `fn` in one transaction as the signed-in staff member, under RLS.
 *
 * The caller's JWT claims and the `authenticated` role (plus an optional statement
 * timeout) are set by one statement that is executed before `fn` runs, so it travels
 * pipelined ahead of the transaction's first query. It carries no bind parameters:
 * with `prepare: false` a parameterised statement costs an extra Describe round trip
 * and stops pipelining. The only variable in it is the staff member's auth user id,
 * which comes from a verified token and must be a UUID before it is written as a
 * literal; the timeout is an integer. The server still runs this statement first; if
 * it fails, the transaction is aborted and nothing in `fn` runs outside the caller's role.
 */
export async function withStaff<T>(session: StaffSession, fn: (tx: Tx) => Promise<T>, options: { statementTimeoutMs?: number } = {}): Promise<T> {
  if (!UUID.test(session.authUserId)) throw new Error("Invalid staff session identity");
  const claims = JSON.stringify({ sub: session.authUserId, role: "authenticated" });
  const timeout = options.statementTimeoutMs === undefined ? null : Math.trunc(options.statementTimeoutMs);
  if (timeout !== null && !(timeout > 0 && timeout <= 600_000)) throw new Error("Invalid statement timeout");
  const scope = `select set_config('request.jwt.claims', '${claims}', true), set_config('role', 'authenticated', true)${timeout === null ? "" : `, set_config('statement_timeout', '${timeout}', true)`}`;
  return sql().begin(async (tx) => {
    const scoped = tx.unsafe(scope).execute();
    const work = fn(tx);
    try {
      await scoped;
    } catch (error) {
      work.catch(() => undefined);
      throw error;
    }
    return work;
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

/**
 * Links a verified Supabase Auth user to a staff record: by auth id, then by
 * email. The CAREER_GATE_ADMIN_EMAIL account is linked (or created) as admin.
 * Returns null when the user is not staff.
 */
export async function resolveStaffForAuthUser(user: { id: string; email: string }) {
  const email = user.email.trim().toLowerCase();
  const adminEmail = process.env.CAREER_GATE_ADMIN_EMAIL?.trim().toLowerCase() || null;
  return sql().begin(async (tx) => {
    const [byId] = await tx`select id, active, role from staff where auth_user_id = ${user.id}`;
    if (byId) {
      if (adminEmail === email && byId.role !== "admin") await tx`update staff set role = 'admin' where id = ${byId.id}`;
      return byId.active ? (byId.id as string) : null;
    }
    const [byEmail] = await tx`select id, active from staff where lower(email) = ${email} and auth_user_id is null for update`;
    if (byEmail) {
      await tx`update staff set auth_user_id = ${user.id}, role = case when ${adminEmail === email} then 'admin' else role end
               where id = ${byEmail.id}`;
      return byEmail.active ? (byEmail.id as string) : null;
    }
    if (adminEmail && adminEmail === email) {
      const [created] = await tx`
        insert into staff (display_name, email, role, auth_user_id) values (${email}, ${email}, 'admin', ${user.id}) returning id`;
      return created.id as string;
    }
    return null;
  });
}
