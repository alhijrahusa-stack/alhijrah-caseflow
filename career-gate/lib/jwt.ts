import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

// Edge-safe (used by middleware and server). Verifies Supabase Auth access
// tokens: HS256 with SUPABASE_JWT_SECRET when set, otherwise the project's
// published JWKS (asymmetric signing keys).
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export type AccessClaims = JWTPayload & { sub: string; email?: string; role?: string };

export async function verifyAccessToken(token: string | undefined | null): Promise<AccessClaims | null> {
  if (!token) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  if (!url) return null;
  const issuer = `${url}/auth/v1`;
  try {
    const secret = process.env.SUPABASE_JWT_SECRET;
    const { payload } = secret
      ? await jwtVerify(token, new TextEncoder().encode(secret), { issuer, audience: "authenticated", algorithms: ["HS256"] })
      : await jwtVerify(token, (jwks ??= createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))), {
          issuer,
          audience: "authenticated",
        });
    if (typeof payload.sub !== "string" || payload.role !== "authenticated") return null;
    return payload as AccessClaims;
  } catch {
    return null;
  }
}

export const ACCESS_COOKIE = "cg_at";
export const REFRESH_COOKIE = "cg_rt";
