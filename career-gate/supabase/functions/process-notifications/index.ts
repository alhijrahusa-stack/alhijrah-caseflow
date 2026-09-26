// Supabase Edge Function (Deno). Drains the notifications queue and sends
// WhatsApp template messages. Schedule it (e.g. every minute with pg_cron +
// pg_net) or invoke it after inserts.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";

const MAX_ATTEMPTS = 5;

type Notification = {
  id: string;
  to_phone: string;
  template: string;
  params: string[];
  attempts: number;
};

async function send(n: Notification): Promise<{ ok: boolean; error?: string; retryable?: boolean }> {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const version = Deno.env.get("WHATSAPP_API_VERSION");
  if (!token || !phoneId || !version) return { ok: false, error: "WhatsApp is not configured", retryable: true };

  const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: n.to_phone,
      type: "template",
      template: {
        name: n.template,
        language: { code: Deno.env.get("WHATSAPP_TEMPLATE_LANG") || "en_US" },
        components: n.params.length
          ? [{ type: "body", parameters: n.params.map((text) => ({ type: "text", text: String(text) })) }]
          : [],
      },
    }),
  });
  if (res.ok) return { ok: true };
  const body = await res.json().catch(() => ({}));
  return {
    ok: false,
    error: body?.error?.message ?? `HTTP ${res.status}`,
    retryable: res.status === 429 || res.status >= 500,
  };
}

Deno.serve(async (req) => {
  // Only callers holding the service role key (cron, admins) may drain the queue.
  const auth = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (auth !== `Bearer ${serviceKey}`) return new Response("Unauthorized", { status: 401 });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: batch, error } = await db.rpc("claim_notifications", { batch_size: 20 });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let sent = 0;
  let failed = 0;
  for (const n of (batch ?? []) as Notification[]) {
    const r = await send(n);
    if (r.ok) {
      sent++;
      await db.from("notifications")
        .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
        .eq("id", n.id);
      continue;
    }
    failed++;
    const giveUp = !r.retryable || n.attempts >= MAX_ATTEMPTS;
    // Exponential backoff: 1, 2, 4, 8… minutes.
    const retryAt = new Date(Date.now() + 2 ** (n.attempts - 1) * 60_000).toISOString();
    await db.from("notifications")
      .update({
        status: giveUp ? "failed" : "queued",
        last_error: r.error ?? "unknown error",
        send_after: giveUp ? undefined : retryAt,
      })
      .eq("id", n.id);
  }

  return Response.json({ claimed: batch?.length ?? 0, sent, failed });
});
