import { describe, expect, it } from "vitest";
import { CLIENT_STAGES, isClientStageFilter } from "@/lib/client-lifecycle-filters";
import { ACTIVE_WORKFLOW_GROUPS, PRIORITY_VIEW, WORKFLOW_DESTINATIONS, WORKFLOW_GROUPS, isWorkflowDestination, workflowGroupForStatus } from "@/lib/workflow-registry";
import { workflowFilter } from "@/lib/workflow-filters";
import type { Tx } from "@/lib/auth";

describe("one workflow navigation and destination registry", () => {
  it("retains six sidebar groups, five active groups and both independent payment leaves", () => {
    expect(WORKFLOW_GROUPS.map(group => group.id)).toEqual(["intake", "account", "job", "appointments", "paperwork", "registry"]);
    expect(ACTIVE_WORKFLOW_GROUPS).toHaveLength(5);
    expect(ACTIVE_WORKFLOW_GROUPS.every(group => !group.sidebarOnly)).toBe(true);
    expect(WORKFLOW_GROUPS.find(group => group.id === "paperwork")).toMatchObject({
      destinations: ["payment_required", "paperwork_pending"], href: "/staff/clients?group=paperwork",
    });
    expect(WORKFLOW_GROUPS.find(group => group.id === "registry")).toMatchObject({
      label: "Confirmed Employment & Records", sidebarOnly: true, destinations: ["completed"],
    });
    expect(workflowGroupForStatus("cancelled")).toBeNull();
  });

  it("has one metadata source for every real destination, with priority only in the legacy read vocabulary", () => {
    expect(CLIENT_STAGES).toBe(WORKFLOW_DESTINATIONS);
    expect(new Set(WORKFLOW_DESTINATIONS.map(destination => destination.id)).size).toBe(8);
    expect(isWorkflowDestination("urgent")).toBe(false);
    expect(isClientStageFilter("urgent")).toBe(true);
    expect(PRIORITY_VIEW.href).toBe("/staff/clients?urgent=1");
    expect(WORKFLOW_DESTINATIONS.find(destination => destination.id === "worksite_change")).toMatchObject({ kind: "special", groupId: null });
    for (const destination of WORKFLOW_DESTINATIONS) {
      if (destination.groupId) expect(WORKFLOW_GROUPS.find(group => group.id === destination.groupId)?.destinations as readonly string[]).toContain(destination.id);
    }
  });

  it("interprets old urgent bookmarks as a flag subset rather than another physical station", () => {
    const tx = ((parts: TemplateStringsArray, ...values: unknown[]) => ({ text: parts.join("?"), values })) as unknown as Tx;
    expect(workflowFilter(tx, "urgent")).toEqual({
      text: "c.is_urgent and c.deleted_at is null and c.current_status not in ('completed','cancelled')", values: [],
    });
    expect(workflowFilter(tx, "account_setup")).toEqual({ text: "c.operational_location=?", values: ["account_setup"] });
  });
});
