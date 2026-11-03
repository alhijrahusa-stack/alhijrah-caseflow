import { describe, expect, it } from "vitest";
import { withStaff, type StaffSession } from "@/lib/auth";

const session = (authUserId: string): StaffSession => ({ authUserId, staff: { id: "00000000-0000-4000-8000-000000000001", display_name: "TEST", email: null, role: "staff" } });

describe("withStaff scope statement", () => {
  it("refuses an identity that is not a UUID before any database call", async () => {
    for (const bad of ["", "x", "00000000-0000-4000-8000-00000000a001'); drop table clients; --", "00000000-0000-4000-8000-00000000a001\""]) {
      await expect(withStaff(session(bad), async () => "ran")).rejects.toThrow("Invalid staff session identity");
    }
  });

  it("refuses a statement timeout outside 1 ms – 10 minutes", async () => {
    const ok = session("00000000-0000-4000-8000-00000000a001");
    for (const statementTimeoutMs of [0, -5, 600_001, Number.NaN]) {
      await expect(withStaff(ok, async () => "ran", { statementTimeoutMs })).rejects.toThrow("Invalid statement timeout");
    }
  });
});
