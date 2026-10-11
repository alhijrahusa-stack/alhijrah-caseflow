import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetBus,
  __subscriberCount,
  COALESCE_MS,
  hasOwner,
  publishChange,
  publishMutation,
  publishPayload,
  subscribeResources,
} from "@/components/staff/realtime/update-bus";
import { ENTITY_RESOURCES, type Resource } from "@/lib/realtime-resources";

const CLIENT_A = "cfdb70b7-7000-4cf1-b8f5-c028c5789be2";
const CLIENT_B = "0ae38bd4-fd62-4e11-973f-1137b2d589c0";

type Update = { resources: Resource[] };

function recorder() {
  const updates: Update[] = [];
  return { updates, onUpdate: (u: { resources: Resource[] }) => updates.push({ resources: [...u.resources].sort() }) };
}

beforeEach(() => {
  __resetBus();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  __resetBus();
});

function settle() {
  vi.advanceTimersByTime(COALESCE_MS);
}

describe("client scoping", () => {
  it("never delivers one client's change to another client's surface", () => {
    const a = recorder();
    const b = recorder();
    subscribeResources({ resources: ["tasks"], clientId: CLIENT_A, onUpdate: a.onUpdate });
    subscribeResources({ resources: ["tasks"], clientId: CLIENT_B, onUpdate: b.onUpdate });

    publishPayload({ table: "tasks", eventType: "INSERT", new: { client_id: CLIENT_A } });
    settle();

    expect(a.updates).toEqual([{ resources: ["tasks"] }]);
    expect(b.updates).toEqual([]);
  });

  it("delivers every client's change to a surface that aggregates all clients", () => {
    const dashboard = recorder();
    subscribeResources({ resources: ["tasks", "attention"], clientId: null, onUpdate: dashboard.onUpdate });

    publishPayload({ table: "tasks", eventType: "INSERT", new: { client_id: CLIENT_A } });
    settle();
    publishPayload({ table: "tasks", eventType: "INSERT", new: { client_id: CLIENT_B } });
    settle();

    expect(dashboard.updates).toHaveLength(2);
  });

  it("withholds an unattributable change from a client-scoped surface", () => {
    // A delete carries only the replica identity. Delivering it to one client's
    // surface would be a guess; it must fall through to recovery instead.
    const a = recorder();
    subscribeResources({ resources: ["tasks"], clientId: CLIENT_A, onUpdate: a.onUpdate });

    expect(publishPayload({ table: "tasks", eventType: "DELETE", old: { id: CLIENT_B } })).toBe("unowned_resource");
    settle();
    expect(a.updates).toEqual([]);
  });
});

describe("resource scoping", () => {
  it("does not invalidate a panel that renders none of the changed resources", () => {
    const notes = recorder();
    const documents = recorder();
    subscribeResources({ resources: ["notes"], clientId: CLIENT_A, onUpdate: notes.onUpdate });
    subscribeResources({ resources: ["documents"], clientId: CLIENT_A, onUpdate: documents.onUpdate });

    publishPayload({ table: "notes", eventType: "INSERT", new: { client_id: CLIENT_A } });
    settle();

    expect(notes.updates).toEqual([{ resources: ["notes"] }]);
    expect(documents.updates).toEqual([]);
  });

  it("delivers only the intersection, not the whole change", () => {
    const readiness = recorder();
    subscribeResources({ resources: ["readiness"], clientId: CLIENT_A, onUpdate: readiness.onUpdate });

    publishPayload({ table: "documents", eventType: "UPDATE", new: { client_id: CLIENT_A } });
    settle();

    // documents touches documents, readiness, next_action and activity; this
    // surface renders readiness alone and is told about readiness alone.
    expect(ENTITY_RESOURCES.documents.length).toBeGreaterThan(1);
    expect(readiness.updates).toEqual([{ resources: ["readiness"] }]);
  });
});

describe("coalescing", () => {
  it("collapses a burst into one delivery per surface", () => {
    const a = recorder();
    subscribeResources({ resources: ["tasks", "notes"], clientId: CLIENT_A, onUpdate: a.onUpdate });

    for (let i = 0; i < 5; i++) publishPayload({ table: "tasks", eventType: "UPDATE", new: { client_id: CLIENT_A } });
    publishPayload({ table: "notes", eventType: "INSERT", new: { client_id: CLIENT_A } });
    settle();

    expect(a.updates).toEqual([{ resources: ["notes", "tasks"] }]);
  });

  it("does not deliver before the window closes", () => {
    const a = recorder();
    subscribeResources({ resources: ["tasks"], clientId: CLIENT_A, onUpdate: a.onUpdate });
    publishPayload({ table: "tasks", eventType: "UPDATE", new: { client_id: CLIENT_A } });
    vi.advanceTimersByTime(COALESCE_MS - 1);
    expect(a.updates).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(a.updates).toHaveLength(1);
  });
});

describe("recovery contract", () => {
  it("reports an unmapped entity rather than delivering it", () => {
    const a = recorder();
    subscribeResources({ resources: ["tasks"], clientId: CLIENT_A, onUpdate: a.onUpdate });
    expect(publishPayload({ table: "staff", eventType: "UPDATE", new: { id: CLIENT_A } })).toBe("unmapped_entity");
    settle();
    expect(a.updates).toEqual([]);
  });

  it("reports a resource no mounted surface owns", () => {
    subscribeResources({ resources: ["notes"], clientId: CLIENT_A, onUpdate: recorder().onUpdate });
    expect(publishPayload({ table: "audit_alerts", eventType: "INSERT", new: { client_id: CLIENT_A } })).toBe("unowned_resource");
  });

  it("reports when nothing is mounted at all", () => {
    expect(publishPayload({ table: "tasks", eventType: "INSERT", new: { client_id: CLIENT_A } })).toBe("unowned_resource");
  });

  it("takes the targeted path when a surface owns the change", () => {
    subscribeResources({ resources: ["tasks"], clientId: CLIENT_A, onUpdate: recorder().onUpdate });
    expect(publishPayload({ table: "tasks", eventType: "INSERT", new: { client_id: CLIENT_A } })).toBeNull();
  });
});

describe("mutation publishing", () => {
  it("delivers a mutation's resources to the owning surface only", () => {
    const tasks = recorder();
    const account = recorder();
    subscribeResources({ resources: ["tasks", "next_action"], clientId: CLIENT_A, onUpdate: tasks.onUpdate });
    subscribeResources({ resources: ["account"], clientId: CLIENT_A, onUpdate: account.onUpdate });

    expect(publishMutation("complete_task", CLIENT_A)).toBeNull();
    settle();

    expect(tasks.updates).toEqual([{ resources: ["next_action", "tasks"] }]);
    expect(account.updates).toEqual([]);
  });

  it("scopes a mutation to its own client", () => {
    const b = recorder();
    subscribeResources({ resources: ["tasks"], clientId: CLIENT_B, onUpdate: b.onUpdate });
    expect(publishMutation("complete_task", CLIENT_A)).toBe("unowned_resource");
    settle();
    expect(b.updates).toEqual([]);
  });

  it("reports an unmapped mutation so the caller falls back", () => {
    subscribeResources({ resources: ["tasks"], clientId: CLIENT_A, onUpdate: recorder().onUpdate });
    expect(publishMutation("set_round_robin", CLIENT_A)).toBe("unmapped_entity");
  });

  it("reaches the account and finance surfaces on a payment", () => {
    const finance = recorder();
    subscribeResources({ resources: ["account", "finance"], clientId: CLIENT_A, onUpdate: finance.onUpdate });
    expect(publishMutation("record_transaction", CLIENT_A)).toBeNull();
    settle();
    expect(finance.updates).toEqual([{ resources: ["account", "finance"] }]);
  });
});

describe("subscription lifecycle", () => {
  it("registers one subscription per surface and releases it on unmount", () => {
    const off = subscribeResources({ resources: ["tasks"], clientId: CLIENT_A, onUpdate: recorder().onUpdate });
    expect(__subscriberCount()).toBe(1);
    off();
    expect(__subscriberCount()).toBe(0);
  });

  it("stops delivering after unmount, including a pending burst", () => {
    const a = recorder();
    const off = subscribeResources({ resources: ["tasks"], clientId: CLIENT_A, onUpdate: a.onUpdate });
    publishPayload({ table: "tasks", eventType: "UPDATE", new: { client_id: CLIENT_A } });
    off();
    settle();
    expect(a.updates).toEqual([]);
  });

  it("does not duplicate delivery when the same surface remounts", () => {
    const a = recorder();
    const off = subscribeResources({ resources: ["tasks"], clientId: CLIENT_A, onUpdate: a.onUpdate });
    off();
    subscribeResources({ resources: ["tasks"], clientId: CLIENT_A, onUpdate: a.onUpdate });
    publishPayload({ table: "tasks", eventType: "UPDATE", new: { client_id: CLIENT_A } });
    settle();
    expect(a.updates).toHaveLength(1);
  });
});

describe("hasOwner", () => {
  it("is false with nothing mounted and true once a surface owns the resource", () => {
    expect(hasOwner(["tasks"], CLIENT_A)).toBe(false);
    subscribeResources({ resources: ["tasks"], clientId: CLIENT_A, onUpdate: recorder().onUpdate });
    expect(hasOwner(["tasks"], CLIENT_A)).toBe(true);
    expect(hasOwner(["tasks"], CLIENT_B)).toBe(false);
    expect(hasOwner(["account"], CLIENT_A)).toBe(false);
  });
});

describe("publishChange", () => {
  it("counts the surfaces that took a change", () => {
    subscribeResources({ resources: ["tasks"], clientId: CLIENT_A, onUpdate: recorder().onUpdate });
    subscribeResources({ resources: ["tasks"], clientId: null, onUpdate: recorder().onUpdate });
    const result = publishChange({ entity: "tasks", event: "UPDATE", clientId: CLIENT_A, resources: ["tasks"] });
    expect(result.delivered).toBe(2);
  });
});
