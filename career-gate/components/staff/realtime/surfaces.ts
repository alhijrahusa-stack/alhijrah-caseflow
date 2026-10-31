import type { Resource } from "@/lib/realtime-resources";

/**
 * Which surface owns which resource, and which payloads that surface renders.
 *
 * Ownership is what makes the targeted path safe to take: once a mounted
 * surface accepts a change, no route refresh follows. So a surface may only
 * claim a resource whose payloads it actually renders -- otherwise it absorbs
 * the change and the panel the operator is looking at goes stale with no
 * fallback. `surfaces.test.ts` holds that line statically.
 */
export type SurfaceContract = {
  resources: readonly Resource[];
  /** Payload keys this surface renders from a scoped refetch. */
  payloads: readonly string[];
};

/** The client file: the client row and every per-client list it renders. */
export const CLIENT_FILE_SURFACE: SurfaceContract = {
  resources: [
    "client_identity", "preferences", "account", "appointments", "tasks", "followups",
    "notes", "documents", "alerts", "assessments", "activity", "placement", "pipeline",
    "import_cases",
  ],
  payloads: [
    "client", "employment", "authorization", "preferences", "account", "appointments",
    "tasks", "followups", "contacts", "notes", "documents", "extractions", "alerts",
    "assessments", "activity", "agentRun", "notifications",
  ],
};

/** The readiness / post-hire panel. */
export const REQUIREMENTS_SURFACE: SurfaceContract = {
  resources: ["readiness"],
  payloads: ["requirements", "readiness", "postHire"],
};

/** The deterministic next action card. */
export const NEXT_ACTION_SURFACE: SurfaceContract = {
  resources: ["next_action"],
  payloads: ["nextAction"],
};

/** Private manager aggregate, refreshed in-place by its own endpoint. */
export const MANAGER_INBOX_SURFACE: SurfaceContract = {
  resources: ["manager_inbox"],
  payloads: ["inbox"],
};

export const SURFACES = {
  client_file: CLIENT_FILE_SURFACE,
  requirements_panel: REQUIREMENTS_SURFACE,
  next_action_card: NEXT_ACTION_SURFACE,
  manager_task_center: MANAGER_INBOX_SURFACE,
} as const;

/**
 * Resources no per-client surface can own, so they stay on recovery.
 *
 * Both are cross-client dashboard rollups: there is no per-client payload that
 * could refresh them, which is why `RESOURCE_PAYLOADS.attention` is empty and
 * `finance` reduces to one client's account.
 */
export const RECOVERY_ONLY_RESOURCES: readonly Resource[] = ["attention", "finance"];
