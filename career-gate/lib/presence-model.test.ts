import { describe, expect, it } from "vitest";
import { clientIdForPresencePath, parsePresencePacket, presenceHref, presenceSection, presenceWorkspaceSection, PRESENCE_STALE_MS, safeStaffPresencePath, selectCurrentPresence, type StaffPresencePacket } from "@/lib/presence-model";

const client = "a5c650d9-4122-4215-923a-0820b759a0cc";
const now = 1_800_000_000_000;
function packet(overrides: Partial<StaffPresencePacket> = {}): StaffPresencePacket {
  return { tab_id: "employee-tab-a", path: "/staff/clients", active_client_id: null, workspace_section: null, state: "active", visible: true, observed_at: now, ...overrides };
}

describe("private staff viewing metadata", () => {
  it("allows internal staff paths and rejects external, query, traversal and encoded routes", () => {
    expect(safeStaffPresencePath("/staff")).toBe("/staff");
    expect(safeStaffPresencePath(`/staff/client/${client}/edit/`)).toBe(`/staff/client/${client}/edit`);
    for (const path of ["https://example.com/staff", "//example.com/staff", "/staff/../admin", "/staff/clients?q=name", "/staff/clients#file", "/staff/%2e%2e", "/staffish", "/staff\\clients", null]) {
      expect(safeStaffPresencePath(path)).toBeNull();
    }
  });
  it("derives the client from the validated route, ignoring a separately forged client identifier", () => {
    expect(clientIdForPresencePath(`/staff/client/${client}/edit`)).toBe(client);
    expect(clientIdForPresencePath("/staff/clients")).toBeNull();
    expect(parsePresencePacket({ ...packet(), path: `/staff/client/${client}`, active_client_id: "forged-client" })?.active_client_id).toBe(client);
    expect(parsePresencePacket({ ...packet(), active_client_id: client })?.active_client_id).toBeNull();
  });
  it("rejects malformed payloads without rendering arbitrary metadata", () => {
    expect(parsePresencePacket({ ...packet(), path: "javascript:alert(1)" })).toBeNull();
    expect(parsePresencePacket({ ...packet(), tab_id: "x" })).toBeNull();
    expect(parsePresencePacket({ ...packet(), state: "administrator" })).toBeNull();
    expect(parsePresencePacket({ ...packet(), observed_at: Infinity })).toBeNull();
    expect(parsePresencePacket({ ...packet(), visible: "true" })).toBeNull();
  });
  it("deduplicates tabs by current foreground activity, then recent observation", () => {
    const foreground = packet({ tab_id: "foreground-tab", observed_at: now - 4_000 });
    const background = packet({ tab_id: "background-tab", visible: false, observed_at: now });
    const idle = packet({ tab_id: "idle-visible-tab", state: "idle", observed_at: now - 1_000 });
    expect(selectCurrentPresence([background, idle, foreground], now)).toBe(foreground);
    const newer = packet({ tab_id: "newer-visible-tab", observed_at: now - 500 });
    expect(selectCurrentPresence([foreground, newer], now)).toBe(newer);
  });
  it("does not claim fresh activity from stale tabs or impossible future timestamps", () => {
    expect(selectCurrentPresence([packet({ observed_at: now - PRESENCE_STALE_MS - 1 }), packet({ observed_at: now + 30_001 })], now)).toBeNull();
    const hidden = packet({ visible: false, state: "idle" });
    expect(selectCurrentPresence([hidden], now)).toBe(hidden);
  });
  it("labels the actual existing workspaces with a safe generic fallback", () => {
    expect(presenceSection("/staff/import")).toEqual({ en: "Smart Client", ar: "Smart Client" });
    expect(presenceSection("/staff/manager-inbox").ar).toBe("مركز مهام المدير");
    expect(presenceSection("/staff/unrecognized").en).toBe("Staff workspace");
  });
  it("shares only the allowlisted Clients subtab and reconstructs a safe link", () => {
    expect(presenceWorkspaceSection("/staff/clients", new URLSearchParams("stage=urgent&q=private-name"))).toBe("urgent");
    expect(presenceWorkspaceSection("/staff/clients", new URLSearchParams())).toBe("new_intake");
    expect(presenceWorkspaceSection("/staff/clients", new URLSearchParams("view=completed"))).toBe("completed");
    expect(presenceWorkspaceSection("/staff/clients", new URLSearchParams("view=all"))).toBe("all");
    expect(presenceWorkspaceSection(`/staff/client/${client}`, new URLSearchParams("stage=urgent"))).toBeNull();
    expect(presenceHref("/staff/clients", "urgent")).toBe("/staff/clients?urgent=1");
    expect(presenceHref("/staff/clients", "completed")).toBe("/staff/clients?view=completed");
    expect(presenceSection("/staff/clients", "urgent").ar).toBe("عرض ملفات الأولوية");
    expect(parsePresencePacket({ ...packet(), workspace_section: "<script>" })?.workspace_section).toBeNull();
    expect(parsePresencePacket({ ...packet(), path: "/staff/import", workspace_section: "urgent" })?.workspace_section).toBeNull();
  });
});
