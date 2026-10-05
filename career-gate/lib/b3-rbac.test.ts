import { describe, expect, it } from "vitest";
import { ACTION_ROLES, STAFF_ELIGIBLE_PERMISSIONS, roleAllows } from "@/lib/authz";

describe("B3 canonical staff-eligible permissions", () => {
  it("derives the registry only from existing actions allowed to staff", () => {
    const expected = Object.entries(ACTION_ROLES)
      .filter(([, roles]) => (roles as readonly string[]).includes("staff"))
      .map(([action]) => action)
      .sort();
    expect([...STAFF_ELIGIBLE_PERMISSIONS].sort()).toEqual(expected);
  });

  it("does not include management or admin authority in full staff mode", () => {
    for (const permission of STAFF_ELIGIBLE_PERMISSIONS) expect(roleAllows("staff", permission)).toBe(true);
    for (const protectedAction of ["create_staff", "update_staff_role", "disable_staff", "assign_staff", "create_client", "soft_delete_client"] as const) {
      expect(STAFF_ELIGIBLE_PERMISSIONS).not.toContain(protectedAction);
      expect(roleAllows("staff", protectedAction)).toBe(false);
    }
  });
});
