import { afterEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "@/lib/providers/messaging";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Resend confirmation idempotency", () => {
  it("uses the same provider Idempotency-Key for retry-safe appointment delivery", async () => {
    vi.stubEnv("RESEND_API_KEY", "local-test-key");
    vi.stubEnv("RESEND_FROM_EMAIL", "notifications@test.invalid");
    const transport = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => ({ id: "em_local_test" }),
    });
    vi.stubGlobal("fetch", transport);

    const result = await sendEmail("applicant@test.invalid", "Appointment", "Details", "<p>Details</p>", "appointment:local-test-key");
    expect(result).toEqual({status:"sent", provider:"resend", provider_id:"em_local_test"});
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, init] = transport.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("appointment:local-test-key");
  });

  it("does not contact a provider when email delivery is unconfigured", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("RESEND_FROM_EMAIL", "");
    const transport = vi.fn();
    vi.stubGlobal("fetch", transport);
    expect(await sendEmail("applicant@test.invalid", "Appointment", "Details", undefined, "appointment:abc"))
      .toMatchObject({ status:"not_configured",provider:"resend" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("keeps failed sends truthful for retry processing", async () => {
    vi.stubEnv("RESEND_API_KEY", "local-test-key");
    vi.stubEnv("RESEND_FROM_EMAIL", "notifications@test.invalid");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,status:503,json:async()=>({message:"temporarily unavailable"})
    }));
    expect(await sendEmail("applicant@test.invalid","Appointment","Details",undefined,"appointment:failed"))
      .toMatchObject({status:"failed",provider:"resend",retryable:true});
  });
});
