import { z } from "zod";
import { fail, json, parseBody } from "@/lib/api";
import { validateSelection } from "@/lib/catalog";
import { createServiceClient } from "@/lib/supabase/server";
import { newRef, normalizePhone } from "@/lib/workflow/refs";

const IntakeSchema = z.object({
  city: z.string().min(1),
  site_code: z.string().min(1),
  job_code: z.string().min(1),
  primary_shift: z.string().min(1),
  backup_shift: z.string().min(1).nullable().optional(),
  pay_expectation_cents: z.number().int().min(0).max(100_000).nullable().optional(),
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  phone: z.string().min(7).max(20),
  email: z.email().max(200).nullable().optional().or(z.literal("")),
  preferred_language: z.enum(["en", "ar", "es"]).default("en"),
  whatsapp_consent: z.boolean(),
  // Honeypot: real users never see or fill this field.
  website: z.string().max(0).optional(),
});

export async function POST(req: Request) {
  const { data, response } = await parseBody(req, IntakeSchema);
  if (response) return response;

  const selectionError = validateSelection(data);
  if (selectionError) return fail(selectionError, 400);

  const phone = normalizePhone(data.phone);
  if (!phone) return fail("phone: enter a 10-digit US number", 400);

  const db = createServiceClient();

  // Retry on the unlikely ref collision (unique violation).
  for (let attempt = 0; attempt < 3; attempt++) {
    const ref = newRef();
    const { data: client, error } = await db
      .from("clients")
      .insert({
        ref,
        first_name: data.first_name,
        last_name: data.last_name,
        phone,
        email: data.email || null,
        preferred_language: data.preferred_language,
        whatsapp_consent: data.whatsapp_consent,
        city: data.city,
        site_code: data.site_code,
        job_code: data.job_code,
        primary_shift: data.primary_shift,
        backup_shift: data.backup_shift ?? null,
        pay_expectation_cents: data.pay_expectation_cents ?? null,
      })
      .select("id, ref")
      .single();

    if (error?.code === "23505") continue;
    if (error) return fail("Could not save application", 500);

    const writes = [
      db.from("activity").insert({
        client_id: client.id, type: "intake_submitted", summary: "Application submitted online",
      }),
    ];
    if (data.whatsapp_consent) {
      writes.push(db.from("notifications").insert({
        client_id: client.id, to_phone: phone, template: "intake_received",
        params: [data.first_name, client.ref],
      }));
    }
    await Promise.all(writes);

    return json({ ref: client.ref }, 201);
  }
  return fail("Could not allocate a reference number", 500);
}
