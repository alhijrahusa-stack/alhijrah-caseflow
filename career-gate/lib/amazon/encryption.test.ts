import { beforeAll, describe, expect, it, vi } from "vitest";
import { decryptAmazonSecret, encryptAmazonSecret } from "@/lib/amazon/encryption";

beforeAll(() => {
  vi.stubEnv("AMAZON_CREDENTIALS_KEY_V1", Buffer.alloc(32, 7).toString("base64"));
});

describe("Amazon credential encryption", () => {
  it("uses authenticated encryption with unique nonces and context binding", async () => {
    const one = await encryptAmazonSecret("top-secret-value", "ctx:one");
    const two = await encryptAmazonSecret("top-secret-value", "ctx:one");
    expect(one.ciphertext).not.toContain("top-secret-value");
    expect(one.nonce).not.toBe(two.nonce);
    expect(await decryptAmazonSecret(one, "ctx:one")).toBe("top-secret-value");
    await expect(decryptAmazonSecret(one, "ctx:two")).rejects.toThrow();
  });
});
