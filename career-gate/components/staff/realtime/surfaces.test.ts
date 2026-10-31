import { describe, expect, it } from "vitest";
import { MANAGER_INBOX_SURFACE, RECOVERY_ONLY_RESOURCES, SURFACES } from "@/components/staff/realtime/surfaces";
import { MUTATION_RESOURCES, RESOURCE_PAYLOADS, RESOURCES } from "@/lib/realtime-resources";

describe("surface ownership", () => {
  it("owns the private manager aggregate through its independent endpoint payload", () => {
    expect(MANAGER_INBOX_SURFACE.resources).toEqual(["manager_inbox"]);
    expect(RESOURCE_PAYLOADS.manager_inbox).toEqual(["inbox"]);
    expect(MANAGER_INBOX_SURFACE.payloads).toContain("inbox");
  });
  it("only claims a resource whose payloads the surface renders", () => {
    // The regression this guards: a surface that claims a resource it cannot
    // render accepts the change, suppresses the fallback, and leaves the panel
    // the operator is looking at stale.
    for (const [name, surface] of Object.entries(SURFACES)) {
      for (const resource of surface.resources) {
        for (const payload of RESOURCE_PAYLOADS[resource]) {
          expect(surface.payloads, `${name} claims ${resource} but does not render ${payload}`).toContain(payload);
        }
      }
    }
  });

  it("gives every resource an owner or an explicit recovery reason", () => {
    const owned = new Set(Object.values(SURFACES).flatMap((s) => s.resources));
    for (const resource of RESOURCES) {
      const covered = owned.has(resource) || RECOVERY_ONLY_RESOURCES.includes(resource);
      expect(covered, `${resource} has no owning surface and is not declared recovery-only`).toBe(true);
    }
  });

  it("does not declare an owned resource recovery-only", () => {
    const owned = new Set(Object.values(SURFACES).flatMap((s) => s.resources));
    for (const resource of RECOVERY_ONLY_RESOURCES) expect(owned.has(resource), resource).toBe(false);
  });

  it("names only declared resources", () => {
    for (const surface of Object.values(SURFACES)) {
      for (const resource of surface.resources) expect(RESOURCES).toContain(resource);
    }
  });

  it("leaves no mutation entirely unowned", () => {
    // A mutation whose every resource is recovery-only would always refresh
    // the route, which is the behaviour this work replaces.
    const owned = new Set(Object.values(SURFACES).flatMap((s) => s.resources));
    for (const [action, resources] of Object.entries(MUTATION_RESOURCES)) {
      expect(resources.some((r) => owned.has(r)), `${action} has no owning surface`).toBe(true);
    }
  });
});
