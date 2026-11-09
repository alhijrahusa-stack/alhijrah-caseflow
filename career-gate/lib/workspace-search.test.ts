import { describe, expect, it } from "vitest";
import { allRegistrySearchHref, currentRegistrySearchHref, prepareWorkspaceSearchNavigation, reconcileWorkspaceSearchNavigation, workspaceSearchNavigationKey, type WorkspaceSearchDraft } from "@/lib/workspace-search";

describe("one workspace search URL contract", () => {
  it("keeps the selected stage, priority, year, staff and saved-filter scope while resetting pagination", () => {
    const href = currentRegistrySearchHref("view=completed&year=2026&confirmation=unconfirmed&urgent=1&assigned=staff-id&sort=started_desc&page=9", "  ALI  ");
    const parsed = new URL(href, "https://example.invalid");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({ view: "completed", year: "2026", confirmation: "unconfirmed", urgent: "1", assigned: "staff-id", sort: "started_desc", q: "ALI" });
  });
  it("clears a query without discarding operational filters", () => {
    expect(currentRegistrySearchHref("group=paperwork&stage=payment_required&q=old&page=4", " ")).toBe("/staff/clients?group=paperwork&stage=payment_required");
  });
  it("opens global results across permitted states and years without inheriting a current-view restriction", () => {
    expect(allRegistrySearchHref("مُحمد & Ali")).toBe("/staff/clients?view=all&q=%D9%85%D9%8F%D8%AD%D9%85%D8%AF+%26+Ali");
  });
});

describe("workspace search navigation races", () => {
  const draft = (overrides: Partial<WorkspaceSearchDraft> = {}): WorkspaceSearchDraft => ({
    base: "/staff/clients?q=ALI&stage=account_setup", path: "/staff/clients", value: "ALI MOHAMED", scope: "current", navigating: false,
    searchHrefs: [workspaceSearchNavigationKey("/staff/clients?stage=account_setup&q=ALI+M")], ...overrides,
  });

  it("retains the newer draft only when its earlier debounced search response arrives", () => {
    const next = reconcileWorkspaceSearchNavigation(draft(), "/staff/clients?stage=account_setup&q=ALI+M");
    expect(next.value).toBe("ALI MOHAMED");
    expect(next.searchHrefs).toEqual([]);
  });

  it("retires older cancelled search targets once a newer search response arrives", () => {
    const href = "/staff/clients?stage=account_setup&q=ALI+M";
    const current = draft({ searchHrefs: [workspaceSearchNavigationKey("/staff/clients?stage=account_setup&q=OLD"), workspaceSearchNavigationKey(href)] });
    expect(reconcileWorkspaceSearchNavigation(current, href).searchHrefs).toEqual([]);
  });

  it("adopts an explicit Clear or saved-filter query instead of reissuing an unsaved draft", () => {
    expect(reconcileWorkspaceSearchNavigation(draft(), "/staff/clients?stage=account_setup").value).toBe("");
    expect(reconcileWorkspaceSearchNavigation(draft(), "/staff/clients?view=completed&q=SAEED").value).toBe("SAEED");
  });

  it("clears an uncommitted draft even when Clear or the stage link points to the current URL", () => {
    const current = draft({ base: "/staff/clients?stage=account_setup", value: "UNCOMMITTED" });
    const next = prepareWorkspaceSearchNavigation(current, "/staff/clients?stage=account_setup");
    expect(next.value).toBe("");
    expect(next.navigating).toBe(false);
    expect(next.searchHrefs).toEqual([]);
  });

  it("restores Back/Forward intent even if the target matches a known in-flight search", () => {
    const href = "/staff/clients?stage=account_setup&q=ALI+M";
    const intentional = prepareWorkspaceSearchNavigation(draft(), href);
    expect(intentional.value).toBe("ALI M");
    expect(intentional.searchHrefs).toEqual([]);
    expect(reconcileWorkspaceSearchNavigation(intentional, href).value).toBe("ALI M");
  });

  it("cancels an older pending query when a sidebar link changes the operational view", () => {
    const intentional = prepareWorkspaceSearchNavigation(draft(), "/staff/clients?stage=job_ready");
    expect(intentional.value).toBe("");
    expect(intentional.navigating).toBe(true);
    expect(reconcileWorkspaceSearchNavigation(intentional, "/staff/clients?stage=job_ready").value).toBe("");
  });
});
