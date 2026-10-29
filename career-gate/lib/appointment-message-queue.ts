import "server-only";

import type postgres from "postgres";
import { enqueue } from "@/lib/jobs";
import { channelConfigured } from "@/lib/notify";
import type { Actor } from "@/lib/service";

export async function queueAppointmentConfirmations(tx: postgres.TransactionSql, appointmentId: string, actor: Actor) {
  const [record] = await tx`
    select a.id,a.client_id,a.scheduled_at,a.status,c.email,c.communication_consent
    from appointments a join clients c on c.id=a.client_id
    where a.id=${appointmentId}`;
  if (!record || record.status !== "confirmed" || !record.communication_consent || !record.email) return [];
  const scheduled = new Date(record.scheduled_at);
  const scheduledKey = scheduled.toISOString();
  const confirm = {template:"appointment_confirmed" as const,runAfter:new Date()};
  const remindAt = new Date(scheduled.getTime() - 24*60*60*1000);
  const events = remindAt.getTime() > Date.now()
    ? [confirm,{template:"appointment_reminder_24h" as const,runAfter:remindAt}] : [confirm];
  const states: {kind:string;status:string}[] = [];
  for (const item of events) {
    const key = `appointment:${appointmentId}:${scheduledKey}:${item.template}`;
    const configured = channelConfigured("email");
    const [row] = await tx`
      insert into notifications(client_id,channel,template,payload,status,idempotency_key)
      values(${record.client_id},'email',${item.template},
        ${tx.json({appointment_id:appointmentId,scheduled_at:scheduledKey})},
        ${configured ? "queued" : "not_configured"},${key})
      on conflict (idempotency_key) where idempotency_key is not null do nothing
      returning id,status`;
    if (row && configured) {
      await enqueue(tx,{type:"notification_send",entityId:String(row.id),dedupeKey:`notify:${row.id}`,
        traceId:actor.traceId,runAfter:item.runAfter,maxAttempts:4});
    }
    states.push({kind:item.template,status:row?String(row.status):"already_queued"});
  }
  return states;
}
