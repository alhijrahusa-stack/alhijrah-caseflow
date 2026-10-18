import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "./db";
import { sendEmail } from "./providers/messaging";
import { hit } from "./ratelimit";
import { logActivity } from "./service";
import { startLookup } from "./status-access";

vi.mock("./db", () => ({ sql: vi.fn() }));
vi.mock("./providers/messaging", () => ({
  sendEmail: vi.fn(),
  sendSms: vi.fn(),
  sendWhatsAppTemplate: vi.fn(),
}));
vi.mock("./ratelimit", () => ({ hit: vi.fn() }));
vi.mock("./service", () => ({ logActivity: vi.fn() }));

describe("public OTP issuance survives post-delivery failures", () => {
  beforeEach(() => {
    vi.stubEnv("STATUS_OTP_PEPPER", "otp-pepper-0123456789abcdef0123456789");
    vi.stubEnv("IP_HASH_PEPPER", "identifier-pepper-0123456789abcdef0123456789");
    vi.mocked(hit).mockResolvedValue(true);
    vi.mocked(logActivity).mockResolvedValue(undefined);
  });
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function database(options: { failHash?: boolean; failDeliveryStatus?: boolean } = {}) {
    let hashSaved = false;
    const query = vi.fn(async (parts: TemplateStringsArray) => {
      const statement = parts.join("?").replace(/\s+/g, " ").toLowerCase();
      if (statement.includes("from clients where")) {
        return [{ id: "00000000-0000-4000-8000-000000000001", email: "recipient@example.test", phone: "3135550100" }];
      }
      if (statement.includes("insert into otp_requests")) {
        return [{ id: "00000000-0000-4000-8000-000000000002" }];
      }
      if (statement.includes("set otp_hash")) {
        if (options.failHash) throw new Error("OTP hash write failed");
        hashSaved = true;
        return [];
      }
      if (statement.includes("set delivery_status")) {
        if (options.failDeliveryStatus) throw new Error("status update unavailable");
        return [];
      }
      throw new Error("Unexpected database call: " + statement);
    });
    vi.mocked(sql).mockReturnValue(query as unknown as ReturnType<typeof sql>);
    return { get hashSaved() { return hashSaved; } };
  }

  it("returns a usable challenge when delivery succeeds but the final status write fails", async () => {
    const dbState = database({ failDeliveryStatus: true });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sendEmail).mockImplementation(async () => {
      expect(dbState.hashSaved).toBe(true);
      return { status: "sent", provider: "resend", provider_id: "email_sent_1" };
    });

    const response = await startLookup("recipient@example.test", "ip-hash", "trace-123");
    expect(response.challengeId).toBe("00000000-0000-4000-8000-000000000002");
    expect(response.delivery).toBe("sent");
    expect(new Date(response.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(logged).toHaveBeenCalledWith("OTP delivery status update failed", expect.objectContaining({ challengeId: response.challengeId }));
  });

  it("does not email a code when the verifiable secret could not be persisted", async () => {
    database({ failHash: true });
    await expect(startLookup("recipient@example.test", "ip-hash", "trace-456")).rejects.toThrow("OTP hash write failed");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
