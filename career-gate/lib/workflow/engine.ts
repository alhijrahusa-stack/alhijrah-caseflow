import type { SupabaseClient } from "@supabase/supabase-js";

export const STAGES = [
  "new",
  "documents_pending",
  "documents_verified",
  "appointment_scheduled",
  "application_submitted",
  "hired",
  "rejected",
  "withdrawn",
] as const;

export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  new: "New",
  documents_pending: "Documents pending",
  documents_verified: "Documents verified",
  appointment_scheduled: "Appointment scheduled",
  application_submitted: "Application submitted",
  hired: "Hired",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export const TERMINAL: ReadonlySet<Stage> = new Set(["hired", "rejected", "withdrawn"]);

const FORWARD: Record<Stage, Stage[]> = {
  new: ["documents_pending"],
  documents_pending: ["documents_verified"],
  documents_verified: ["appointment_scheduled", "documents_pending"],
  appointment_scheduled: ["application_submitted", "documents_verified"],
  application_submitted: ["hired", "rejected"],
  hired: [],
  rejected: [],
  withdrawn: [],
};

/** Stages reachable from `from`. Any open case may be withdrawn. */
export function allowedTransitions(from: Stage): Stage[] {
  if (TERMINAL.has(from)) return [];
  return [...FORWARD[from], "withdrawn"];
}

export function isStage(value: unknown): value is Stage {
  return typeof value === "string" && (STAGES as readonly string[]).includes(value);
}

export type TransitionFacts = {
  verifiedDocuments: number;
  scheduledAppointments: number;
};

/** Returns a reason the transition is blocked, or null when it may proceed. */
export function guardTransition(from: Stage, to: Stage, facts: TransitionFacts): string | null {
  if (!allowedTransitions(from).includes(to)) {
    return `Cannot move from ${STAGE_LABELS[from]} to ${STAGE_LABELS[to]}`;
  }
  if (to === "documents_verified" && facts.verifiedDocuments < 1) {
    return "At least one document must be marked verified";
  }
  if (to === "appointment_scheduled" && facts.scheduledAppointments < 1) {
    return "Schedule an appointment first";
  }
  return null;
}

export type SideEffects = {
  task?: { title: string; dueInHours: number };
  notify?: { template: string };
};

/** Follow-up work created when a client enters a stage. */
export function sideEffectsFor(to: Stage): SideEffects {
  switch (to) {
    case "documents_pending":
      return {
        task: { title: "Collect ID and work authorization", dueInHours: 48 },
        notify: { template: "documents_requested" },
      };
    case "documents_verified":
      return { task: { title: "Schedule appointment", dueInHours: 24 } };
    case "appointment_scheduled":
      return { notify: { template: "appointment_confirmed" } };
    case "application_submitted":
      return {
        task: { title: "Follow up on application decision", dueInHours: 72 },
        notify: { template: "application_submitted" },
      };
    case "hired":
      return { notify: { template: "hired" } };
    default:
      return {};
  }
}

type Client = {
  id: string;
  ref: string;
  first_name: string;
  phone: string;
  whatsapp_consent: boolean;
  stage: Stage;
};

/**
 * Moves a client to `to`, recording history, activity, follow-up tasks and
 * queued notifications. The stage update is conditional on the stage read,
 * so two concurrent transitions cannot both succeed.
 */
export async function transition(
  db: SupabaseClient,
  args: { clientId: string; to: Stage; actorId: string | null; note?: string; now?: Date },
): Promise<{ ok: true; from: Stage; to: Stage } | { ok: false; error: string; status: number }> {
  const now = args.now ?? new Date();

  const { data: client, error: readErr } = await db
    .from("clients")
    .select("id, ref, first_name, phone, whatsapp_consent, stage")
    .eq("id", args.clientId)
    .maybeSingle<Client>();
  if (readErr) return { ok: false, error: readErr.message, status: 500 };
  if (!client) return { ok: false, error: "Client not found", status: 404 };

  const [docs, appts] = await Promise.all([
    db.from("documents").select("id", { count: "exact", head: true })
      .eq("client_id", client.id).eq("verified", true),
    db.from("appointments").select("id", { count: "exact", head: true })
      .eq("client_id", client.id).eq("status", "scheduled"),
  ]);
  if (docs.error || appts.error) {
    return { ok: false, error: (docs.error ?? appts.error)!.message, status: 500 };
  }

  const blocked = guardTransition(client.stage, args.to, {
    verifiedDocuments: docs.count ?? 0,
    scheduledAppointments: appts.count ?? 0,
  });
  if (blocked) return { ok: false, error: blocked, status: 409 };

  const { data: updated, error: updErr } = await db
    .from("clients")
    .update({ stage: args.to })
    .eq("id", client.id)
    .eq("stage", client.stage)
    .select("id");
  if (updErr) return { ok: false, error: updErr.message, status: 500 };
  if (!updated?.length) return { ok: false, error: "Stage changed by someone else; reload", status: 409 };

  const effects = sideEffectsFor(args.to);
  const writes = [
    db.from("workflow_events").insert({
      client_id: client.id, from_stage: client.stage, to_stage: args.to,
      actor: args.actorId, note: args.note ?? null,
    }),
    db.from("activity").insert({
      client_id: client.id, actor: args.actorId, type: "stage_changed",
      summary: `${STAGE_LABELS[client.stage]} → ${STAGE_LABELS[args.to]}`,
      data: { from: client.stage, to: args.to, note: args.note ?? null },
    }),
  ];
  if (effects.task) {
    writes.push(db.from("tasks").insert({
      client_id: client.id, title: effects.task.title, created_by: args.actorId,
      due_at: new Date(now.getTime() + effects.task.dueInHours * 3_600_000).toISOString(),
    }));
  }
  if (effects.notify && client.whatsapp_consent) {
    writes.push(db.from("notifications").insert({
      client_id: client.id, to_phone: client.phone, template: effects.notify.template,
      params: [client.first_name, client.ref],
    }));
  }
  const results = await Promise.all(writes);
  const failed = results.find((r) => r.error);
  if (failed?.error) return { ok: false, error: failed.error.message, status: 500 };

  return { ok: true, from: client.stage, to: args.to };
}
