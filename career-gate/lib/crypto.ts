import "server-only";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const sha256Hex = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

function pepper(name: "STATUS_OTP_PEPPER" | "IP_HASH_PEPPER") {
  const v = process.env[name];
  if (!v || v.length < 32) throw new Error(`${name} must be set (at least 32 characters)`);
  return v;
}

/** Keyed hash for identifiers stored or compared server-side (IPs, contacts). */
export function hashIdentifier(value: string) {
  return createHmac("sha256", pepper("IP_HASH_PEPPER")).update(value.trim().toLowerCase()).digest("hex");
}

export function otpHash(challengeId: string, code: string) {
  return createHmac("sha256", pepper("STATUS_OTP_PEPPER")).update(`${challengeId}:${code}`).digest("hex");
}

export function safeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export const newOtpCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const newSessionToken = () => randomBytes(32).toString("base64url");
export const sessionTokenHash = (token: string) => sha256Hex(`status-session:${token}`);

/** Stable fingerprint of a JSON body (keys sorted recursively). */
export function fingerprint(value: unknown): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === "object"
        ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
        : v;
  return sha256Hex(JSON.stringify(canon(value)));
}
