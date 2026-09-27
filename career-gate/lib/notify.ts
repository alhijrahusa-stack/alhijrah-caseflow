import "server-only";
import type postgres from "postgres";
import { sql } from "@/lib/db";
import type { Channel } from "@/lib/domain";
import { dateTime } from "@/lib/format";
import { enqueue } from "@/lib/jobs";
import { OFFICE } from "@/lib/office";
import { providerStates, registry } from "@/lib/providers/config";
import { sendEmail, sendSms, sendWhatsAppTemplate, type SendResult } from "@/lib/providers/messaging";
import { logActivity, type Actor } from "@/lib/service";

export function channelConfigured(channel: Channel) {
  const s = providerStates();
  return channel === "whatsapp" ? s.whatsapp_meta === "CONFIGURED" : channel === "sms" ? s.sms_twilio === "CONFIGURED" : s.email_resend === "CONFIGURED";
}

export type SubmissionPayload = { first_name: string; ref: string; submitted_at: string };

export function renderSubmission(p: SubmissionPayload) {
  const base = registry.app().baseUrl;
  const statusHelp = base
    ? `Check your status at ${base}/status with your reference; we will send you a one-time code.`
    : "Contact the office to check your status.";
  const text = [
    `Hello ${p.first_name},`,
    `${OFFICE.product} (${OFFICE.company}) received your employment request on ${dateTime(p.submitted_at)}.`,
    `Reference: ${p.ref}`,
    statusHelp,
    `Office: ${OFFICE.phone} · WhatsApp ${OFFICE.whatsapp} · ${OFFICE.email}`,
  ].join("\n");
  return { subject: `${OFFICE.product} request ${p.ref} received`, text, whatsappParams: [p.first_name, p.ref, dateTime(p.submitted_at)] };
}

/**
 * Records the submission notification for each permitted channel with a
 * contact. Configured channels are queued for sending; unconfigured ones are
 * recorded as not_configured. Nothing is ever marked sent here.
 */
export async function queueSubmissionNotifications(
  tx: postgres.TransactionSql,
  c: { id: string; phone: string; email: string | null; consent: boolean; payload: SubmissionPayload },
  actor: Actor,
) {
  if (!c.consent) return [];
  const channels: Channel[] = ["whatsapp", "sms", ...(c.email ? (["email"] as const) : [])];
  const out: { channel: Channel; status: string }[] = [];
  for (const channel of channels) {
    const configured = channelConfigured(channel);
    const [n] = await tx`
      insert into notifications (client_id, channel, template, payload, status)
      values (${c.id}, ${channel}, 'submission_received', ${tx.json(c.payload)}, ${configured ? "queued" : "not_configured"})
      returning id`;
    if (configured) {
      await enqueue(tx, { type: "notification_send", entityId: n.id, dedupeKey: `notify:${n.id}`, traceId: actor.traceId });
      await logActivity(tx, { clientId: c.id, action: "notification_queued", actor, entityType: "notification", entityId: n.id, newValue: { channel } });
    } else {
      await logActivity(tx, { clientId: c.id, action: "notification_not_configured", actor, entityType: "notification", entityId: n.id, newValue: { channel } });
    }
    out.push({ channel, status: configured ? "queued" : "not_configured" });
  }
  return out;
}

/** Sends one queued notification. Returns the provider result. */
export async function deliverNotification(id: string): Promise<SendResult | { status: "skipped" }> {
  const db = sql();
  const [n] = await db`
    update notifications set status = 'sending', attempts = attempts + 1
    where id = ${id} and status in ('queued', 'sending')
    returning *`;
  if (!n) return { status: "skipped" };
  const [contact] = await db`select phone, email from clients where id = ${n.client_id}`;
  const payload = n.payload as SubmissionPayload;
  const msg = renderSubmission(payload);
  const result: SendResult =
    n.channel === "sms"
      ? await sendSms(contact.phone, msg.text)
      : n.channel === "whatsapp"
        ? await sendWhatsAppTemplate(contact.phone, registry.whatsapp().templateSubmission, msg.whatsappParams)
        : await sendEmail(contact.email, msg.subject, msg.text);

  const actor: Actor = { staffId: null, traceId: `notify:${id}` };
  if (result.status === "sent") {
    await db`update notifications set status = 'sent', provider = ${result.provider}, provider_id = ${result.provider_id},
               sent_at = now(), error = null where id = ${id}`;
    await logActivity(db, { clientId: n.client_id, action: "notification_sent", actor, entityType: "notification", entityId: id, newValue: { channel: n.channel, provider: result.provider } });
  } else if (result.status === "not_configured") {
    await db`update notifications set status = 'not_configured', provider = ${result.provider} where id = ${id}`;
    await logActivity(db, { clientId: n.client_id, action: "notification_not_configured", actor, entityType: "notification", entityId: id, newValue: { channel: n.channel } });
  } else {
    await db`update notifications set status = 'failed', provider = ${result.provider}, error = ${result.error.slice(0, 500)} where id = ${id}`;
    await logActivity(db, { clientId: n.client_id, action: "notification_failed", actor, entityType: "notification", entityId: id, newValue: { channel: n.channel, error: result.error.slice(0, 200) } });
  }
  return result;
}
