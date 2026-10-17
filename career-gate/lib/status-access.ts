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
  if (/^CG-\d{4}-\d{6}$/i.test(v)) return { kind: "reference", value: v.toUpperCase() };
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
  let subject:
    | { clientId: string; importCaseId: null; phone: string; email: string | null }
    | { clientId: null; importCaseId: string; phone: string; email: string | null }
    | null = null;

  if (c) {
    const clientRows =
      c.kind === "reference"
        ? await db`select id, phone, email from clients where ref = ${c.value} and deleted_at is null`
        : c.kind === "email"
          ? await db`select id, phone, email from clients where lower(email) = ${c.value} and deleted_at is null order by created_at desc limit 1`
          : await db`select id, phone, email from clients where regexp_replace(phone,'\\D','','g') = ${c.value} and deleted_at is null order by created_at desc limit 1`;

    const client = clientRows[0] as { id: string; phone: string; email: string | null } | undefined;
    if (client) {
      subject = { clientId: String(client.id), importCaseId: null, phone: String(client.phone), email: client.email ? String(client.email) : null };
    } else {
      const pendingRows =
        c.kind === "reference"
          ? await db`
              select id,
                     mapped_draft #>> '{profile,phone}' as phone,
                     mapped_draft #>> '{profile,email}' as email
              from client_import_cases
              where upper(public_ref)=${c.value} and created_client_id is null
              order by created_at desc limit 1`
          : c.kind === "email"
            ? await db`
                select id,
                       mapped_draft #>> '{profile,phone}' as phone,
                       mapped_draft #>> '{profile,email}' as email
                from client_import_cases
                where lower(coalesce(mapped_draft #>> '{profile,email}',''))=${c.value}
                  and created_client_id is null
                order by created_at desc limit 1`
            : await db`
                select id,
                       mapped_draft #>> '{profile,phone}' as phone,
                       mapped_draft #>> '{profile,email}' as email
                from client_import_cases
                where regexp_replace(coalesce(mapped_draft #>> '{profile,phone}',''),'\\D','','g')=${c.value}
                  and created_client_id is null
                order by created_at desc limit 1`;
      const pending = pendingRows[0] as { id: string; phone: string | null; email: string | null } | undefined;
      if (pending?.phone || pending?.email) {
        subject = {
          clientId: null,
          importCaseId: String(pending.id),
          phone: String(pending.phone ?? ""),
          email: pending.email ? String(pending.email) : null,
        };
      }
    }
  }

  const expires = new Date(Date.now() + OTP_TTL_SECONDS * 1000);
  if (!subject) {
    const [row] = await db`
      insert into otp_requests (delivery_status, expires_at, ip_hash) values ('no_match', ${expires}, ${ipHash}) returning id`;
    return { challengeId: row.id as string, delivery: "no_match" as const };
  }

  const channel: "email" | "sms" = c!.kind === "phone" || !subject.email ? "sms" : "email";
  const to = channel === "email" ? subject.email! : subject.phone;
  if (!to) {
    const [row] = await db`
      insert into otp_requests (client_id, import_case_id, delivery_status, expires_at, ip_hash)
      values (${subject.clientId}, ${subject.importCaseId}, 'no_contact', ${expires}, ${ipHash}) returning id`;
    return { challengeId: row.id as string, delivery: "no_contact" as const };
  }

  const contactHash = hashIdentifier(`${channel}:${to}`);
  const [row] = await db`
    insert into otp_requests (client_id, import_case_id, contact_type, contact_value_hash, delivery_status, expires_at, ip_hash)
    values (${subject.clientId}, ${subject.importCaseId}, ${channel}, ${contactHash}, 'not_configured', ${expires}, ${ipHash}) returning id`;
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

  if (subject.clientId) {
    try { await logActivity(db, {
      clientId: subject.clientId,
      action: "status_otp_requested",
      actor: { staffId: null, traceId },
      entityType: "otp_request",
      entityId: challengeId,
      newValue: { channel, delivery },
    }); } catch (error) { console.error("OTP audit unavailable", error); }
  }
  return { challengeId, delivery, contactHash };
}

export type VerifyResult = { ok: true; ref: string; token: string } | { ok: false; code: "invalid" | "expired" | "locked" };

export async function verifyCode(challengeId: string, code: string, ipHash: string, traceId: string): Promise<VerifyResult> {
  const db = sql();
  return db.begin(async (tx) => {
    const [r] = await tx`select * from otp_requests where id = ${challengeId} for update`;
    if (!r || (!r.client_id && !r.import_case_id) || !r.otp_hash) return { ok: false, code: "invalid" } as const;
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
    await tx`
      insert into status_sessions (client_id, import_case_id, token_hash, expires_at, ip_hash)
      values (${r.client_id}, ${r.import_case_id}, ${sessionTokenHash(token)}, ${new Date(Date.now() + SESSION_TTL_SECONDS * 1000)}, ${ipHash})`;

    let ref: string;
    if (r.client_id) {
      const [client] = await tx`select ref from clients where id = ${r.client_id}`;
      ref = String(client.ref);
      await logActivity(tx, {
        clientId: String(r.client_id),
        action: "status_otp_verified",
        actor: { staffId: null, traceId },
        entityType: "otp_request",
        entityId: challengeId,
      });
    } else {
      const [importCase] = await tx`select public_ref from client_import_cases where id = ${r.import_case_id}`;
      if (!importCase) return { ok: false, code: "invalid" } as const;
      ref = String(importCase.public_ref);
    }
    return { ok: true, ref, token } as const;
  });
}

export type StatusSessionSubject = {
  clientId: string | null;
  importCaseId: string | null;
};

export async function sessionStatusSubject(ref: string, token: string | undefined): Promise<StatusSessionSubject | null> {
  if (!token) return null;
  const db = sql();
  const [s] = await db`
    select s.id,
           coalesce(s.client_id, i.created_client_id) as effective_client_id,
           s.import_case_id,
           c.ref as client_ref,
           i.public_ref as import_ref
    from status_sessions s
    left join client_import_cases i on i.id=s.import_case_id
    left join clients c on c.id=coalesce(s.client_id,i.created_client_id) and c.deleted_at is null
    where s.token_hash=${sessionTokenHash(token)}
      and s.revoked_at is null
      and s.expires_at > now()
      and upper(coalesce(c.ref,i.public_ref,''))=${ref.toUpperCase()}
    limit 1`;
  if (!s) return null;
  await db`update status_sessions set last_access=now() where id=${s.id}`;
  return {
    clientId: s.effective_client_id ? String(s.effective_client_id) : null,
    importCaseId: s.import_case_id ? String(s.import_case_id) : null,
  };
}

/** Backward-compatible client-only session lookup. */
export async function sessionClient(ref: string, token: string | undefined) {
  const subject = await sessionStatusSubject(ref, token);
  return subject?.clientId ?? null;
}

