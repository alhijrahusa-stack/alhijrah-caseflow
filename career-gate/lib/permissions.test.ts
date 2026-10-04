import { describe, expect, it } from "vitest";
import {
  STAFF_PERMISSION_KEYS,
  effectivePermissions,
  isStaffPermission,
  normalizePermissions,
  permissionAllows,
} from "@/lib/permissions";

describe("B3 granular permissions", () => {
  it("full mode grants every canonical permission", () => {
    expect(effectivePermissions("full", [])).toEqual(STAFF_PERMISSION_KEYS);
    for (const permission of STAFF_PERMISSION_KEYS) expect(permissionAllows("full", [], permission)).toBe(true);
  });

  it("custom mode grants only selected canonical permissions", () => {
    expect(permissionAllows("custom", ["verify_document"], "verify_document")).toBe(true);
    expect(permissionAllows("custom", ["verify_document"], "process_document")).toBe(false);
  });

  it("normalizes duplicates and rejects unknown permission keys", () => {
    expect(normalizePermissions(["verify_document", "verify_document", "not_real"])).toEqual(["verify_document"]);
    expect(isStaffPermission("manage_staff_permissions")).toBe(true);
    expect(isStaffPermission("not_real")).toBe(false);
  });
});
