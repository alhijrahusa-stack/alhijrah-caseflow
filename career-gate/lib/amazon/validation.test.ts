import { describe, expect, it } from "vitest";
import { AddAmazonEmailSchema, normalizeAmazonEmail } from "@/lib/amazon/validation";

describe("Amazon credential validation", () => {
  it("normalizes email without changing secret fields", () => {
    const parsed = AddAmazonEmailSchema.parse({ email: "  Test.Account@GMAIL.COM ", password: "Secret-Password-1", pin: "123456" });
    expect(parsed).toEqual({ email: "test.account@gmail.com", password: "Secret-Password-1", pin: "123456" });
    expect(normalizeAmazonEmail(" A@B.COM ")).toBe("a@b.com");
  });
  it("rejects malformed email, short password and non-numeric pin", () => {
    expect(AddAmazonEmailSchema.safeParse({ email: "bad", password: "short", pin: "abc" }).success).toBe(false);
  });
});
