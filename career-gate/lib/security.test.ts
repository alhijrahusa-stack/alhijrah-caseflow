import { createHmac } from "node:crypto";
import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fingerprint, otpHash } from "./crypto";
import { backoffSeconds } from "./jobs";
import { verifyAccessToken } from "./jwt";
import { geminiExtract } from "./providers/gemini";
import { sendEmail, sendSms, sendWhatsAppTemplate, verifyMetaSignature, verifyResendSignature, verifyTwilioSignature } from "./providers/messaging";
import { redact } from "./semantic";

const URL_ = "https://proj.supabase.co";
const SECRET = "test-jwt-secret-with-enough-length-000000";
const mint = (claims: Record<string, unknown>, opts: { secret?: string; exp?: string; iss?: string } = {}) =>
  new SignJWT({ role: "authenticated", ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(opts.iss ?? `${URL_}/auth/v1`)
    .setAudience("authenticated")
    .setSubject("11111111-1111-1111-1111-111111111111")
    .setExpirationTime(opts.exp ?? "5m")
    .sign(new TextEncoder().encode(opts.secret ?? SECRET));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", URL_);
  vi.stubEnv("SUPABASE_JWT_SECRET", SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("staff JWT verification", () => {
  it("accepts a valid Supabase access token", async () => {
    expect((await verifyAccessToken(await mint({})))?.sub).toBe("11111111-1111-1111-1111-111111111111");
  });
  it("rejects wrong secret, wrong issuer, expired, and non-authenticated role", async () => {
    expect(await verifyAccessToken(await mint({}, { secret: "another-secret-another-secret-000000" }))).toBeNull();
    expect(await verifyAccessToken(await mint({}, { iss: "https://evil/auth/v1" }))).toBeNull();
    expect(await verifyAccessToken(await mint({}, { exp: "-1m" }))).toBeNull();
    expect(await verifyAccessToken(await mint({ role: "anon" }))).toBeNull();
    expect(await verifyAccessToken("not-a-jwt")).toBeNull();
  });
});

describe("hashing and redaction", () => {
  it("fingerprints are key-order independent", () => {
    expect(fingerprint({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(fingerprint({ b: { d: [1, 2], c: 2 }, a: 1 }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
  });
  it("OTP hashing requires a server pepper and differs per challenge", () => {
    vi.stubEnv("STATUS_OTP_PEPPER", "");
    expect(() => otpHash("c1", "123456")).toThrow();
    vi.stubEnv("STATUS_OTP_PEPPER", "p".repeat(40));
    expect(otpHash("c1", "123456")).not.toBe(otpHash("c2", "123456"));
  });
  it("redacts contact details and identifiers before embedding", () => {
    const r = redact("Call 313-555-0100 or mail a@b.com; SSN 123-45-6789; A123456789");
    expect(r).not.toMatch(/313|a@b|6789|123456789/);
  });
  it("job backoff grows and is capped", () => {
    expect([1, 2, 3].map(backoffSeconds)).toEqual([30, 60, 120]);
    expect(backoffSeconds(20)).toBe(3600);
  });
});

describe("providers are truthful", () => {
  it("returns not_configured without credentials and never calls out", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await sendSms("3135550100", "x")).status).toBe("not_configured");
    expect((await sendEmail("a@b.co", "s", "x")).status).toBe("not_configured");
    expect((await sendWhatsAppTemplate("3135550100", "t", [])).status).toBe("not_configured");
    expect((await geminiExtract({ model: "fast", mimeType: "image/png", data: new Uint8Array([1]), prompt: "", responseSchema: {} })).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it("reports provider failure (5xx retryable) instead of success", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC1");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "t");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+13130000000");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "boom" }), { status: 503 })));
    expect(await sendSms("3135550100", "x")).toEqual({ status: "failed", provider: "twilio", error: "boom", retryable: true });
  });
  it("reports vision timeouts", async () => {
    vi.stubEnv("GOOGLE_GEMINI_API_KEY", "k");
    vi.stubEnv("DOCUMENT_VISION_FAST_MODEL", "m");
    vi.stubGlobal("fetch", vi.fn(async () => { const e = new Error("timed out"); e.name = "TimeoutError"; throw e; }));
    const r = await geminiExtract({ model: "fast", mimeType: "image/png", data: new Uint8Array([1]), prompt: "", responseSchema: {} });
    expect(r.ok === false && r.code).toBe("TIMEOUT");
  });
});

describe("webhook signatures", () => {
  it("Twilio", () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
    const params = { MessageSid: "SM1", MessageStatus: "delivered" };
    const sig = createHmac("sha1", "tok").update("https://x/api/webhooks/twilioMessageSidSM1MessageStatusdelivered").digest("base64");
    expect(verifyTwilioSignature("https://x/api/webhooks/twilio", params, sig)).toBe(true);
    expect(verifyTwilioSignature("https://x/api/webhooks/twilio", { ...params, MessageStatus: "failed" }, sig)).toBe(false);
  });
  it("Meta", () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "sec");
    const body = '{"a":1}';
    expect(verifyMetaSignature(body, `sha256=${createHmac("sha256", "sec").update(body).digest("hex")}`)).toBe(true);
    expect(verifyMetaSignature(body, "sha256=00")).toBe(false);
  });
  it("Resend (Svix)", () => {
    const key = Buffer.from("resend-test-key").toString("base64");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", `whsec_${key}`);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", Buffer.from(key, "base64")).update(`msg_1.${ts}.{}`).digest("base64");
    expect(verifyResendSignature("{}", "msg_1", ts, `v1,${sig}`)).toBe(true);
    expect(verifyResendSignature("{}", "msg_1", String(Number(ts) - 1000), `v1,${sig}`)).toBe(false);
  });
});
