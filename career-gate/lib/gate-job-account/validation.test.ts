import { describe, expect, it } from "vitest";
import { AddGateJobEmailSchema, normalizeGateJobEmail } from "@/lib/gate-job-account/validation";

describe("Gate Job credential validation", () => {
  it("normalizes email without changing secret fields", () => {
    const parsed = AddGateJobEmailSchema.parse({ email: "  Test.Account@GMAIL.COM ", password: "Secret-Password-1", pin: "123456" });
    expect(parsed).toEqual({ email: "test.account@gmail.com", password: "Secret-Password-1", pin: "123456" });
    expect(normalizeGateJobEmail(" A@B.COM ")).toBe("a@b.com");
  });
  it("rejects malformed email, short password and non-numeric pin", () => {
    expect(AddGateJobEmailSchema.safeParse({ email: "bad", password: "short", pin: "abc" }).success).toBe(false);
  });
});
