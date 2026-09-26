import { z } from "zod";
import { fail, json, parseBody, requireStaff } from "@/lib/api";

const Create = z.object({
  clientId: z.uuid(),
  kind: z.enum(["orientation", "document_check", "hiring_event", "follow_up"]),
  startsAt: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().min(5).max(480),
  location: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
});

const Update = z.object({
  id: z.uuid(),
  status: z.enum(["scheduled", "completed", "no_show", "cancelled"]),
});

export async function GET(req: Request) {
  const { staff, response } = await requireStaff();
  if (response) return response;
  const url = new URL(req.url);
  let q = staff.supabase
    .from("appointments")
    .select("id, client_id, kind, starts_at, ends_at, location, status, notes, clients(ref, first_name, last_name)")
    .order("starts_at");
  const clientId = url.searchParams.get("clientId");
  if (clientId) q = q.eq("client_id", clientId);
  const from = url.searchParams.get("from");
  if (from) q = q.gte("starts_at", from);
  const { data, error } = await q.limit(500);
  if (error) return fail(error.message, 500);
  return json(data);
}

export async function POST(req: Request) {
  const { staff, response } = await requireStaff();
  if (response) return response;
  const { data, response: bad } = await parseBody(req, Create);
  if (bad) return bad;

  const starts = new Date(data.startsAt);
  const ends = new Date(starts.getTime() + data.durationMinutes * 60_000);
  const { data: appt, error } = await staff.supabase
    .from("appointments")
    .insert({
      client_id: data.clientId, kind: data.kind, starts_at: starts.toISOString(),
      ends_at: ends.toISOString(), location: data.location ?? null, notes: data.notes ?? null,
      created_by: staff.user.id,
    })
    .select()
    .single();
  if (error) return fail(error.message, 500);

  await staff.supabase.from("activity").insert({
    client_id: data.clientId, actor: staff.user.id, type: "appointment_created",
    summary: `Appointment (${data.kind.replace("_", " ")}) set for ${starts.toISOString()}`,
    data: { appointment_id: appt.id },
  });
  return json(appt, 201);
}

export async function PATCH(req: Request) {
  const { staff, response } = await requireStaff();
  if (response) return response;
  const { data, response: bad } = await parseBody(req, Update);
  if (bad) return bad;

  const { data: appt, error } = await staff.supabase
    .from("appointments")
    .update({ status: data.status })
    .eq("id", data.id)
    .select("id, client_id, status")
    .maybeSingle();
  if (error) return fail(error.message, 500);
  if (!appt) return fail("Not found", 404);

  await staff.supabase.from("activity").insert({
    client_id: appt.client_id, actor: staff.user.id, type: "appointment_updated",
    summary: `Appointment marked ${data.status.replace("_", " ")}`, data: { appointment_id: appt.id },
  });
  return json(appt);
}
