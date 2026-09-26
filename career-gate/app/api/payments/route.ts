import { z } from "zod";
import { fail, json, parseBody, requireStaff } from "@/lib/api";

const Create = z.object({
  clientId: z.uuid(),
  amountCents: z.number().int().positive().max(10_000_000),
  method: z.enum(["cash", "card", "zelle", "check", "other"]),
  reference: z.string().max(200).optional(),
  receivedAt: z.iso.datetime({ offset: true }).optional(),
});

const Update = z.object({
  id: z.uuid(),
  status: z.enum(["refunded", "void"]),
});

export async function GET(req: Request) {
  const { staff, response } = await requireStaff();
  if (response) return response;
  const clientId = new URL(req.url).searchParams.get("clientId");
  if (!clientId) return fail("clientId is required", 400);
  const { data, error } = await staff.supabase
    .from("payments")
    .select("*")
    .eq("client_id", clientId)
    .order("received_at", { ascending: false });
  if (error) return fail(error.message, 500);
  return json(data);
}

export async function POST(req: Request) {
  const { staff, response } = await requireStaff();
  if (response) return response;
  const { data, response: bad } = await parseBody(req, Create);
  if (bad) return bad;

  const { data: payment, error } = await staff.supabase
    .from("payments")
    .insert({
      client_id: data.clientId, amount_cents: data.amountCents, method: data.method,
      reference: data.reference ?? null, received_at: data.receivedAt ?? new Date().toISOString(),
      recorded_by: staff.user.id,
    })
    .select()
    .single();
  if (error) return fail(error.message, 500);

  await staff.supabase.from("activity").insert({
    client_id: data.clientId, actor: staff.user.id, type: "payment_recorded",
    summary: `Payment of $${(data.amountCents / 100).toFixed(2)} (${data.method}) recorded`,
    data: { payment_id: payment.id },
  });
  return json(payment, 201);
}

/** Refund or void. RLS limits this to admins; a 404 covers both absent and forbidden. */
export async function PATCH(req: Request) {
  const { staff, response } = await requireStaff();
  if (response) return response;
  const { data, response: bad } = await parseBody(req, Update);
  if (bad) return bad;

  const { data: payment, error } = await staff.supabase
    .from("payments")
    .update({ status: data.status })
    .eq("id", data.id)
    .eq("status", "received")
    .select("id, client_id, amount_cents")
    .maybeSingle();
  if (error) return fail(error.message, 500);
  if (!payment) return fail("Not found, already changed, or admin only", 404);

  await staff.supabase.from("activity").insert({
    client_id: payment.client_id, actor: staff.user.id, type: "payment_updated",
    summary: `Payment of $${(payment.amount_cents / 100).toFixed(2)} marked ${data.status}`,
    data: { payment_id: payment.id },
  });
  return json(payment);
}
