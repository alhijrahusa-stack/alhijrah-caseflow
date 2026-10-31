"use client";

import {
  affects,
  describeChange,
  resourcesForMutation,
  type ChangePayload,
  type Resource,
  type ResourceChange,
} from "@/lib/realtime-resources";

/**
 * Entity-scoped update bus.
 *
 * A surface registers the resources it renders and the client it is scoped to.
 * A change is delivered only to the surfaces whose rendered resources
 * intersect the change and whose client scope matches, so a change to one
 * client never invalidates another client's surface and a change to one
 * resource never invalidates an unrelated panel.
 *
 * The bus never refreshes a route. When a change cannot be delivered to any
 * subscriber -- an unknown entity, or a resource nothing on screen owns -- it
 * reports that, and `requestRecovery` raises the single recovery signal that
 * the realtime listener answers with `router.refresh()`.
 */

/** Window over which a burst of changes collapses into one delivery. */
export const COALESCE_MS = 120;

export const RECOVERY_EVENT = "career-gate:realtime-recovery";

export type RecoveryReason =
  | "unmapped_entity"
  | "unowned_resource"
  | "subscription_recovered"
  | "targeted_fetch_failed";

export type Subscription = {
  /** Resources this surface renders. */
  resources: readonly Resource[];
  /** Client the surface is scoped to; null means it aggregates all clients. */
  clientId: string | null;
  /** Called at most once per coalesce window with the resources touched. */
  onUpdate: (update: { resources: Resource[]; changes: ResourceChange[] }) => void;
};

type Entry = Subscription & {
  pendingResources: Set<Resource>;
  pendingChanges: ResourceChange[];
  timer: ReturnType<typeof setTimeout> | null;
};

const entries = new Map<number, Entry>();
let nextId = 1;

/** Registers a surface. Returns the unsubscribe function. */
export function subscribeResources(sub: Subscription): () => void {
  const id = nextId++;
  entries.set(id, { ...sub, pendingResources: new Set(), pendingChanges: [], timer: null });
  return () => {
    const entry = entries.get(id);
    if (entry?.timer) clearTimeout(entry.timer);
    entries.delete(id);
  };
}

function inScope(entry: Entry, clientId: string | null): boolean {
  // A surface that aggregates all clients takes every change.
  if (entry.clientId === null) return true;
  // A change that cannot be attributed to a client cannot be proven to belong
  // to this surface; it is left to the recovery path rather than misdelivered.
  if (clientId === null) return false;
  return entry.clientId === clientId;
}

function flush(id: number) {
  const entry = entries.get(id);
  if (!entry) return;
  entry.timer = null;
  const resources = [...entry.pendingResources];
  const changes = entry.pendingChanges;
  entry.pendingResources = new Set();
  entry.pendingChanges = [];
  if (resources.length === 0) return;
  entry.onUpdate({ resources, changes });
}

function enqueue(id: number, entry: Entry, change: ResourceChange, matched: Resource[]) {
  for (const r of matched) entry.pendingResources.add(r);
  entry.pendingChanges.push(change);
  if (entry.timer) return;
  entry.timer = setTimeout(() => flush(id), COALESCE_MS);
}

export type DeliveryResult = { delivered: number; resources: readonly Resource[] };

/** Delivers a resolved change to every matching subscriber. */
const EXECUTIVE_RESOURCES=new Set<Resource>(["client_identity","pipeline","placement","finance","account","readiness","documents","appointments","tasks","followups","alerts","attention"]);

export function publishChange(change: ResourceChange): DeliveryResult {
  if (typeof window !== "undefined" && change.resources.some(resource=>EXECUTIVE_RESOURCES.has(resource))) window.dispatchEvent(new CustomEvent("career-gate:executive-refresh", { detail: { resources: change.resources } }));
  let delivered = 0;
  for (const [id, entry] of entries) {
    if (!inScope(entry, change.clientId)) continue;
    const matched = change.resources.filter((r) => entry.resources.includes(r));
    if (matched.length === 0) continue;
    delivered++;
    enqueue(id, entry, change, matched);
  }
  return { delivered, resources: change.resources };
}

/**
 * Resolves a realtime payload through the graph and delivers it.
 *
 * Returns the recovery reason when the targeted path could not be taken:
 * `unmapped_entity` when the payload names no known entity, `unowned_resource`
 * when no mounted surface renders anything the change touches. A null return
 * means the change was handled entirely by targeted delivery.
 */
export function publishPayload(payload: ChangePayload): RecoveryReason | null {
  const change = describeChange(payload);
  if (!change) return "unmapped_entity";
  const { delivered } = publishChange(change);
  return delivered > 0 ? null : "unowned_resource";
}

/**
 * Delivers the resource set a completed staff mutation invalidates.
 *
 * Returns the recovery reason when the mutation is unmapped or nothing on
 * screen owns the affected resources, so the caller can fall back.
 */
export function publishMutation(action: string, clientId: string | null): RecoveryReason | null {
  const resources = resourcesForMutation(action);
  if (resources.length === 0) return "unmapped_entity";
  const { delivered } = publishChange({ entity: "clients", event: "UPDATE", clientId, resources });
  return delivered > 0 ? null : "unowned_resource";
}

/** True when a mounted surface would receive this change. */
export function hasOwner(resources: readonly Resource[], clientId: string | null): boolean {
  for (const entry of entries.values()) {
    if (!inScope(entry, clientId)) continue;
    if (affects(entry.resources, resources)) return true;
  }
  return false;
}

/**
 * Raises the recovery signal. The realtime listener is the only holder of the
 * router and answers this with a debounced `router.refresh()`. This is the
 * fallback path, never the normal one.
 */
export function requestRecovery(reason: RecoveryReason) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(RECOVERY_EVENT, { detail: { reason } }));
}

/** Test-only: drops every subscription and pending timer. */
export function __resetBus() {
  for (const entry of entries.values()) if (entry.timer) clearTimeout(entry.timer);
  entries.clear();
  nextId = 1;
}

/** Test-only: number of mounted subscriptions. */
export function __subscriberCount() {
  return entries.size;
}
