// Shared office access key. This is not per-user authentication: it is a
// single office secret that keeps client records off the open internet.
export const STAFF_COOKIE = "cg_staff";

const enc = new TextEncoder();

async function hmac(key: string, message: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(message)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function accessKey() {
  return process.env.STAFF_ACCESS_KEY || null;
}

/** The gate is open only in development when no key is configured. */
export function gateDisabled() {
  return !accessKey() && process.env.NODE_ENV !== "production";
}

export async function cookieValue(key: string) {
  return hmac(key, "career-gate-staff-v1");
}

export async function verifyCookie(value: string | undefined) {
  if (gateDisabled()) return true;
  const key = accessKey();
  if (!key || !value) return false;
  return timingSafeEqual(value, await cookieValue(key));
}

export async function verifyKey(candidate: string) {
  const key = accessKey();
  if (!key) return false;
  // Compare digests so the comparison time does not depend on the key.
  return timingSafeEqual(await hmac("cmp", candidate), await hmac("cmp", key));
}
