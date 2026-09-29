import "server-only";
import { hashIdentifier, newOtpCode, newSessionToken, otpHash, safeEqualHex, sessionTokenHash } from "@/lib/crypto";
import { sql } from "@/lib/db";
import { OFFICE } from "@/lib/office";
import { registry } from "@/lib/providers/config";
import { sendEmail, sendSms, sendWhatsAppTemplate, type SendResult } from "@/lib/providers/messaging";
import { hit } from "@/lib/ratelimit";
import { normalizePhone } from "@/lib/schemas";
import { logActivity } from "@/lib/service";

export const OTP_TTL_SECONDS = 300;
export const OTP_MAX_ATTEMPTS = 3;
export const LOCK_SECONDS = 900;
export const SESSION_TTL_SECONDS = 1800;
export const STATUS_COOKIE = "cg_status";

export type LookupKind = "reference" | "email" | "phone";

export function classify(identifier: string): { kind: LookupKind; value: string } | null {
  const v = identifier.trim();
  if (/^(CG-\d{4}-\d{6}|ALH-\d{8}-[A-Z0-9]{4})$/i.test(v)) return { kind: "reference", value: v.toUpperCase() };
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { kind: "email", value: v.toLowerCase() };
  const p = normalizePhone(v);
  return p ? { kind: "phone", value: p } : null;
}

async function deliverOtp(channel: "email" | "sms" | "whatsapp", to: string, code: string): Promise<SendResult> {
  const text = `${OFFICE.product} status code: ${code}. It expires in 5 minutes. If you did not request it, ignore this message.`;
  if (channel === "email") return sendEmail(to, `${OFFICE.product} status code`, text);
  if (channel === "whatsapp") return sendWhatsAppTemplate(to, registry.whatsapp().templateOtp, [code]);
  return sendSms(to, text);
}

/**
 * Always returns an opaque challenge id and the same public response, whether
 * or not a client matched. When one matches, a code goes to a contact already
 * on file (email for email/reference lookups when present, otherwise SMS).
 */
export async function startLookup(identifier: string, ipHash: string, traceId: string) {
  const db = sql();
  const c = classify(identifier);
  let client: { id: string; phone: string; email: string | null } | undefined;
  if (c) {
    const rows =
      c.kind === "reference"
        ? await db`
            select c.id, c.phone, c.email
            from clients c
            where c.deleted_at is null
              and (
                upper(c.ref) = ${c.value}
                or exists (
                  select 1 from career_gate_applications a
                  where a.client_id = c.id and upper(a.case_number) = ${c.value}
                )
              )
            order by c.updated_at desc
            limit 1`
        : c.kind === "email"
          ? await db`select id, phone, email from clients where lower(email) = ${c.value} and deleted_at is null order by created_at desc limit 1`
          : await db`select id, phone, email from clients where regexp_replace(phone, '\\D', '', 'g') = ${c.value.replace(/\D/g, "")} and deleted_at is null order by created_at desc limit 1`;
    client = rows[0] as typeof client;
  }

  const expires = new Date(Date.now() + OTP_TTL_SECONDS * 1000);
  if (!client) {
    const [row] = await db`
      insert into otp_requests (delivery_status, expires_at, ip_hash) values ('no_match', ${expires}, ${ipHash}) returning id`;
    return { challengeId: row.id as string, delivery: "no_match" as const };
  }

  const channel: "email" | "sms" = c!.kind === "phone" || !client.email ? "sms" : "email";
  const to = channel === "email" ? client.email! : client.phone;
  const contactHash = hashIdentifier(`${channel}:${to}`);
  const [row] = await db`
    insert into otp_requests (client_id, contact_type, contact_value_hash, delivery_status, expires_at, ip_hash)
    values (${client.id}, ${channel}, ${contactHash}, 'not_configured', ${expires}, ${ipHash}) returning id`;
  const challengeId = row.id as string;
  if (!(await hit("otp_send_hour", contactHash))) {
    await db`update otp_requests set delivery_status = 'failed' where id = ${challengeId}`;
    return { challengeId, delivery: "rate_limited" as const, contactHash };
  }
  const code = newOtpCode();
  const result = await deliverOtp(channel, to, code);
  const delivery = result.status === "sent" ? "sent" : result.status === "not_configured" ? "not_configured" : "failed";
  await db`update otp_requests set otp_hash = ${delivery === "sent" ? otpHash(challengeId, code) : null}, delivery_status = ${delivery}
           where id = ${challengeId}`;
  await logActivity(db, { clientId: client.id, action: "status_otp_requested", actor: { staffId: null, traceId }, entityType: "otp_request", entityId: challengeId, newValue: { channel, delivery } });
  return { challengeId, delivery, contactHash };
}

export type VerifyResult = { ok: true; ref: string; token: string } | { ok: false; code: "invalid" | "expired" | "locked" };

/** Checks a code: 5-minute expiry, 3 attempts, 15-minute lock, single use. */
export async function verifyCode(challengeId: string, code: string, ipHash: string, traceId: string): Promise<VerifyResult> {
  const db = sql();
  return db.begin(async (tx) => {
    const [r] = await tx`select * from otp_requests where id = ${challengeId} for update`;
    if (!r || !r.client_id || !r.otp_hash) return { ok: false, code: "invalid" } as const;
    if (r.locked_until && new Date(r.locked_until) > new Date()) return { ok: false, code: "locked" } as const;
    if (r.verified_at) return { ok: false, code: "invalid" } as const;
    if (new Date(r.expires_at) <= new Date()) return { ok: false, code: "expired" } as const;
    if (r.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, code: "locked" } as const;

    const good = /^\d{6}$/.test(code) && safeEqualHex(otpHash(challengeId, code), r.otp_hash);
    if (!good) {
      const attempts = r.attempts + 1;
      await tx`update otp_requests set attempts = ${attempts},
                 locked_until = ${attempts >= OTP_MAX_ATTEMPTS ? new Date(Date.now() + LOCK_SECONDS * 1000) : null}
               where id = ${challengeId}`;
      return { ok: false, code: attempts >= OTP_MAX_ATTEMPTS ? "locked" : "invalid" } as const;
    }
    await tx`update otp_requests set verified_at = now(), attempts = attempts + 1 where id = ${challengeId}`;
    const token = newSessionToken();
    await tx`insert into status_sessions (client_id, token_hash, expires_at, ip_hash)
             values (${r.client_id}, ${sessionTokenHash(token)}, ${new Date(Date.now() + SESSION_TTL_SECONDS * 1000)}, ${ipHash})`;
    const [c] = await tx`
      select coalesce(
        (select a.case_number from career_gate_applications a where a.client_id = c.id order by a.created_at desc limit 1),
        c.ref
      ) as public_ref
      from clients c
      where c.id = ${r.client_id}`;
    await logActivity(tx, { clientId: r.client_id, action: "status_otp_verified", actor: { staffId: null, traceId }, entityType: "otp_request", entityId: challengeId });
    return { ok: true, ref: c.public_ref as string, token } as const;
  });
}

/** Returns the client id bound to the caller's status session for this public ref, or null. */
export async function sessionClient(ref: string, token: string | undefined) {
  if (!token) return null;
  const db = sql();
  const normalized = ref.trim().toUpperCase();
  const [s] = await db`
    select s.id, s.client_id
    from status_sessions s
    join clients c on c.id = s.client_id
    where s.token_hash = ${sessionTokenHash(token)}
      and s.revoked_at is null
      and s.expires_at > now()
      and c.deleted_at is null
      and (
        upper(c.ref) = ${normalized}
        or exists (
          select 1 from career_gate_applications a
          where a.client_id = c.id and upper(a.case_number) = ${normalized}
        )
      )`;
  if (!s) return null;
  await db`update status_sessions set last_access = now() where id = ${s.id}`;
  return s.client_id as string;
}
