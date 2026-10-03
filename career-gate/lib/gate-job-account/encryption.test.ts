import { beforeAll, describe, expect, it, vi } from "vitest";
import { decryptGateJobSecret, encryptGateJobSecret } from "@/lib/gate-job-account/encryption";

beforeAll(() => {
  vi.stubEnv("GATE_JOB_CREDENTIALS_KEY_V1", Buffer.alloc(32, 7).toString("base64"));
});

describe("Gate Job credential encryption", () => {
  it("uses authenticated encryption with unique nonces and context binding", async () => {
    const one = await encryptGateJobSecret("top-secret-value", "ctx:one");
    const two = await encryptGateJobSecret("top-secret-value", "ctx:one");
    expect(one.ciphertext).not.toContain("top-secret-value");
    expect(one.nonce).not.toBe(two.nonce);
    expect(await decryptGateJobSecret(one, "ctx:one")).toBe("top-secret-value");
    await expect(decryptGateJobSecret(one, "ctx:two")).rejects.toThrow();
  });
});
