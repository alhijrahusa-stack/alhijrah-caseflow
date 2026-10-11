import { describe, expect, it } from "vitest";
import {
  clientIdFromPayload,
  describeChange,
  ENTITY_RESOURCES,
  MUTATION_RESOURCES,
  payloadsForResources,
  REALTIME_ENTITIES,
  RESOURCE_PAYLOADS,
  RESOURCES,
  resourcesForEntity,
  resourcesForMutation,
} from "@/lib/realtime-resources";

const CLIENT = "cfdb70b7-7000-4cf1-b8f5-c028c5789be2";
const OTHER = "0ae38bd4-fd62-4e11-973f-1137b2d589c0";

describe("entity coverage", () => {
  it("maps every subscribed table to at least one resource", () => {
    for (const table of REALTIME_ENTITIES) {
      expect(resourcesForEntity(table).length, table).toBeGreaterThan(0);
    }
  });

  it("covers every table the staff channels subscribe to", () => {
    // Keep the graph and the channel table lists in step: a table added to a
    // channel without a mapping would silently fall back to a route refresh.
    for (const table of [
      "clients", "client_preferences", "client_accounts", "appointments", "tasks",
      "followups", "notes", "documents", "audit_alerts", "client_import_cases",
    ]) {
      expect(resourcesForEntity(table).length, table).toBeGreaterThan(0);
    }
  });

  it("names only declared resources", () => {
    for (const [table, resources] of Object.entries(ENTITY_RESOURCES)) {
      for (const resource of resources) expect(RESOURCES, `${table}.${resource}`).toContain(resource);
    }
  });

  it("returns nothing for a table outside the graph", () => {
    expect(resourcesForEntity("staff")).toHaveLength(0);
    expect(resourcesForEntity("")).toHaveLength(0);
  });

  it("invalidates the next action for every entity that can move the workflow", () => {
    // ONE CLIENT -> ONE ACCOUNT -> ONE WORKFLOW -> ONE NEXT ACTION: anything
    // that changes workflow state must invalidate the single next action.
    for (const table of ["clients", "client_preferences", "client_accounts", "appointments", "tasks", "followups", "documents"] as const) {
      expect(ENTITY_RESOURCES[table], table).toContain("next_action");
    }
  });

  it("keeps a note out of the readiness and next-action graph", () => {
    // A note is a record of what happened, never a workflow gate.
    expect(ENTITY_RESOURCES.notes).toEqual(["notes", "activity"]);
  });
});

describe("client id resolution", () => {
  it("reads the primary key for a clients row", () => {
    expect(clientIdFromPayload({ table: "clients", new: { id: CLIENT } })).toBe(CLIENT);
  });

  it("reads client_id for every other entity", () => {
    expect(clientIdFromPayload({ table: "tasks", new: { id: OTHER, client_id: CLIENT } })).toBe(CLIENT);
  });

  it("falls back to the old row for a delete", () => {
    expect(clientIdFromPayload({ table: "tasks", new: null, old: { client_id: CLIENT } })).toBe(CLIENT);
  });

  it("does not mistake a row id for a client id", () => {
    // A delete carries only the replica identity, so there is no client to
    // attribute the change to. Guessing would invalidate the wrong client.
    expect(clientIdFromPayload({ table: "tasks", old: { id: OTHER } })).toBeNull();
  });

  it("rejects anything that is not a uuid", () => {
    expect(clientIdFromPayload({ table: "clients", new: { id: "not-a-uuid" } })).toBeNull();
    expect(clientIdFromPayload({ table: "tasks", new: { client_id: 7 } })).toBeNull();
    expect(clientIdFromPayload({ table: "tasks" })).toBeNull();
  });
});

describe("describeChange", () => {
  it("resolves event, entity, client and resources", () => {
    expect(describeChange({ table: "tasks", eventType: "UPDATE", new: { client_id: CLIENT } })).toEqual({
      entity: "tasks",
      event: "UPDATE",
      clientId: CLIENT,
      resources: ENTITY_RESOURCES.tasks,
    });
  });

  it("normalises the event type and defaults an unknown one to UPDATE", () => {
    expect(describeChange({ table: "notes", eventType: "insert", new: { client_id: CLIENT } })?.event).toBe("INSERT");
    expect(describeChange({ table: "notes", new: { client_id: CLIENT } })?.event).toBe("UPDATE");
  });

  it("returns null for a table outside the graph so the caller can recover", () => {
    expect(describeChange({ table: "staff", new: { id: OTHER } })).toBeNull();
    expect(describeChange({})).toBeNull();
  });

  it("keeps an unattributable change resolvable but unscoped", () => {
    const change = describeChange({ table: "tasks", eventType: "DELETE", old: { id: OTHER } });
    expect(change?.clientId).toBeNull();
    expect(change?.resources).toContain("tasks");
  });
});

describe("mutation graph", () => {
  it("names only declared resources", () => {
    for (const [action, resources] of Object.entries(MUTATION_RESOURCES)) {
      expect(resources.length, action).toBeGreaterThan(0);
      for (const resource of resources) expect(RESOURCES, `${action}.${resource}`).toContain(resource);
    }
  });

  it("returns nothing for an unmapped mutation", () => {
    expect(resourcesForMutation("set_round_robin")).toHaveLength(0);
    expect(resourcesForMutation("")).toHaveLength(0);
  });

  it("TASK COMPLETE invalidates task, next action, dashboard attention and activity", () => {
    expect([...resourcesForMutation("complete_task")].sort()).toEqual(
      ["activity", "attention", "next_action", "tasks"],
    );
  });

  it("DOCUMENT REVIEW invalidates document, readiness, next action and activity", () => {
    for (const action of ["verify_document", "reject_document", "request_reupload"]) {
      expect([...resourcesForMutation(action)].sort(), action).toEqual(
        ["activity", "documents", "next_action", "readiness"],
      );
    }
  });

  it("PAYMENT invalidates the ledger account, the finance KPI and activity", () => {
    const payment = resourcesForMutation("record_transaction");
    expect(payment).toContain("account");
    expect(payment).toContain("finance");
    expect(payment).toContain("activity");
  });

  it("PLACEMENT CONFIRMATION invalidates lifecycle, pipeline buckets, activity and commission eligibility", () => {
    const placement = resourcesForMutation("confirm_started");
    // lifecycle, the Active -> Completed bucket move, activity, and the
    // account that carries commission eligibility.
    for (const resource of ["placement", "pipeline", "activity", "account", "next_action"]) {
      expect(placement, resource).toContain(resource);
    }
  });
});

describe("resource payloads", () => {
  it("declares a payload set for every resource", () => {
    for (const resource of RESOURCES) expect(RESOURCE_PAYLOADS[resource], resource).toBeDefined();
  });

  it("deduplicates payloads across resources", () => {
    const payloads = payloadsForResources(["client_identity", "pipeline", "placement"]);
    expect(payloads.filter((p) => p === "client").length).toBe(1);
    expect(payloads).toEqual(["client", "employment", "authorization"]);
  });

  it("asks for nothing when a resource has no scoped payload", () => {
    // `attention` is a cross-client dashboard rollup: there is no per-client
    // payload that can refresh it, so it must fall through to recovery.
    expect(payloadsForResources(["attention"])).toHaveLength(0);
  });

  it("requests only what the changed resources need", () => {
    expect(payloadsForResources(["tasks"])).toEqual(["tasks"]);
    expect(payloadsForResources(["documents"])).toEqual(["documents", "extractions"]);
    expect(payloadsForResources(["readiness"])).toEqual(["requirements", "postHire"]);
    expect(payloadsForResources(["assessments"])).toEqual(["assessments"]);
  });
});
