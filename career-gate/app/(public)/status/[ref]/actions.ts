"use server";

import { findJob, findSite, shiftLabel } from "@/lib/catalog";
import { createServiceClient } from "@/lib/supabase/server";
import { STAGE_LABELS, type Stage } from "@/lib/workflow/engine";

export type StatusState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "found";
      stage: string;
      site: string;
      job: string;
      shift: string;
      nextAppointment: string | null;
    };

/**
 * Looks up an application by reference plus the last four digits of the
 * phone on file, so a leaked or guessed reference alone reveals nothing.
 */
export async function lookupStatus(_prev: StatusState, form: FormData): Promise<StatusState> {
  const ref = String(form.get("ref") ?? "").toUpperCase().trim();
  const last4 = String(form.get("last4") ?? "").replace(/\D/g, "");
  if (!/^CG-[A-Z0-9]{8}$/.test(ref) || last4.length !== 4) {
    return { status: "error", message: "Enter your reference and the last 4 digits of your phone." };
  }

  const db = createServiceClient();
  const { data: client } = await db
    .from("clients")
    .select("id, phone, stage, city, site_code, job_code, primary_shift")
    .eq("ref", ref)
    .maybeSingle();

  // Same message whether the ref or the digits are wrong.
  if (!client || !client.phone.endsWith(last4)) {
    return { status: "error", message: "No application matches those details." };
  }

  const { data: appt } = await db
    .from("appointments")
    .select("starts_at")
    .eq("client_id", client.id)
    .eq("status", "scheduled")
    .gte("starts_at", new Date().toISOString())
    .order("starts_at")
    .limit(1)
    .maybeSingle();

  return {
    status: "found",
    stage: STAGE_LABELS[client.stage as Stage] ?? client.stage,
    site: findSite(client.city, client.site_code)?.name ?? client.site_code,
    job: findJob(client.city, client.site_code, client.job_code)?.title ?? client.job_code,
    shift: shiftLabel(client.primary_shift),
    nextAppointment: appt?.starts_at ?? null,
  };
}
