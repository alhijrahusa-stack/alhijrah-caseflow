import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { StaffSession } from "@/lib/auth";
import { CLIENT_EDITABLE_FIELDS, type ClientEditableField } from "@/lib/client-intake-fields";
import { sql } from "@/lib/db";
import { ActionError } from "@/lib/service";

export { CLIENT_EDITABLE_FIELDS } from "@/lib/client-intake-fields";
export type { ClientEditableField } from "@/lib/client-intake-fields";

/**
 * One-time client intake links.
 *
 * A staff member issues a link and sends it to the client. The client opens it,
 * enters their own source data, uploads documents, reviews what the existing
 * deterministic intelligence detected, and submits — once. The submission is
 * handed to the existing Smart Client Import staging unchanged.
 *
 * Two rules govern the lifecycle:
 *
 *   Opening or refreshing a link never consumes it. Only a submission whose
 *   staging succeeded moves the link to USED.
 *
 *   The raw token exists only in the URL. This module stores its SHA-256 digest
 *   and never logs, returns or persists the raw value after issuing it.
 */

/** 32 random bytes, base64url — the only place the raw token is produced. */
const TOKEN_BYTES = 32;

export const INTAKE_LINK_DEFAULT_TTL_HOURS = 24;
export const INTAKE_LINK_MAX_TTL_HOURS = 168;

/** How long a submission may hold PROCESSING before another attempt may recover it. */
export const INTAKE_LINK_PROCESSING_STALE_MINUTES = 15;

export type IntakeLinkStatus = "ACTIVE" | "PROCESSING" | "USED" | "REVOKED";

export type IntakeLinkRow = {
  id: string;
  status: IntakeLinkStatus;
  issued_by: string;
  expires_at: string;
  processing_started_at: string | null;
  used_at: string | null;
  revoked_at: string | null;
  import_case_id: string | null;
  created_at: string;
};

/** The digest stored for a raw token. */
export function hashIntakeToken(rawToken: string) {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** A base64url token of 32 random bytes, and its digest. */
export function mintIntakeToken() {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashIntakeToken(token) };
}

/** A token shaped like one this module mints, before it ever reaches the database. */
export function looksLikeIntakeToken(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

/**
 * The idempotency key a link's submission always uses.
 *
 * It is derived from the link alone, so a retry after a crash — or a recovery of
 * a stale PROCESSING state — reaches the same existing staged case instead of
 * creating a second one.
 */
export function intakeIdempotencyKey(tokenHash: string) {
  return `client-link:${tokenHash}`;
}

function management(role: string) {
  return role === "admin" || role === "manager";
}

/** Issues a link for the given staff member. Returns the raw token once. */
export async function issueIntakeLink(session: StaffSession, ttlHours: number) {
  if (!management(session.staff.role)) {
    throw new ActionError("forbidden", "Client intake links require manager or admin access", 403);
  }
  if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > INTAKE_LINK_MAX_TTL_HOURS) {
    throw new ActionError("invalid_expiry", `Expiry must be between 1 and ${INTAKE_LINK_MAX_TTL_HOURS} hours`, 400);
  }
  const { token, tokenHash } = mintIntakeToken();
  const [row] = await sql()`
    insert into client_import_links(token_hash,issued_by,expires_at)
    values(${tokenHash},${session.staff.id},now() + make_interval(hours => ${Math.floor(ttlHours)}))
    returning id,status,expires_at,created_at`;
  return {
    id: String(row.id),
    token,
    status: String(row.status) as IntakeLinkStatus,
    expires_at: new Date(row.expires_at as string | Date).toISOString(),
    created_at: new Date(row.created_at as string | Date).toISOString(),
  };
}

/** Revokes an ACTIVE link. A USED link is never revoked — it is already spent. */
export async function revokeIntakeLink(session: StaffSession, linkId: string) {
  if (!management(session.staff.role)) {
    throw new ActionError("forbidden", "Client intake links require manager or admin access", 403);
  }
  const [existing] = await sql()`select id,status from client_import_links where id=${linkId}`;
  if (!existing) throw new ActionError("not_found", "Link not found", 404);
  if (existing.status === "USED") throw new ActionError("already_used", "A used link cannot be revoked", 409);
  if (existing.status === "REVOKED") return { id: linkId, status: "REVOKED" as IntakeLinkStatus };

  const [row] = await sql()`
    update client_import_links
    set status='REVOKED',revoked_at=now(),processing_started_at=null
    where id=${linkId} and status in ('ACTIVE','PROCESSING')
    returning id,status`;
  if (!row) throw new ActionError("conflict", "Link could not be revoked", 409);
  return { id: String(row.id), status: String(row.status) as IntakeLinkStatus };
}

/** The links a staff member has issued, newest first. Never includes a token. */
export async function listIntakeLinks(session: StaffSession, limit = 10) {
  if (!management(session.staff.role)) {
    throw new ActionError("forbidden", "Client intake links require manager or admin access", 403);
  }
  const rows = await sql()`
    select id,status,expires_at,used_at,revoked_at,created_at
    from client_import_links
    where issued_by=${session.staff.id}
    order by created_at desc
    limit ${Math.min(Math.max(1, limit), 50)}`;
  return rows.map((row) => ({
    id: String(row.id),
    status: String(row.status) as IntakeLinkStatus,
    expires_at: new Date(row.expires_at as string | Date).toISOString(),
    used_at: row.used_at ? new Date(row.used_at as string | Date).toISOString() : null,
    revoked_at: row.revoked_at ? new Date(row.revoked_at as string | Date).toISOString() : null,
    created_at: new Date(row.created_at as string | Date).toISOString(),
  }));
}

export type IntakeLinkRejection = "not_found" | "gone";

/**
 * Reads a link for the public page without consuming it.
 *
 * It answers only whether the page may be opened. A token that does not exist
 * and one that is revoked are reported the same way to the extent the HTTP
 * contract allows, so nothing here reveals whether some other token exists.
 */
export async function readIntakeLinkForClient(rawToken: string): Promise<
  { ok: true; openable: true } | { ok: false; reason: IntakeLinkRejection }
> {
  if (!looksLikeIntakeToken(rawToken)) return { ok: false, reason: "not_found" };
  const [row] = await sql()`
    select status,expires_at from client_import_links where token_hash=${hashIntakeToken(rawToken)}`;
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status === "USED" || row.status === "REVOKED") return { ok: false, reason: "gone" };
  if (new Date(row.expires_at as string | Date).getTime() <= Date.now()) return { ok: false, reason: "gone" };
  return { ok: true, openable: true };
}

export type ClaimedIntakeLink = {
  id: string;
  tokenHash: string;
  issuer: StaffSession;
};

/**
 * Takes exclusive ownership of a link for one submission.
 *
 * A single UPDATE moves ACTIVE — or a PROCESSING state abandoned longer than
 * `INTAKE_LINK_PROCESSING_STALE_MINUTES` — to PROCESSING. Because the predicate
 * is evaluated under the row lock the UPDATE takes, exactly one concurrent
 * request can win; the rest see no row and are rejected.
 */
export async function claimIntakeLink(rawToken: string): Promise<
  { ok: true; link: ClaimedIntakeLink } | { ok: false; reason: IntakeLinkRejection | "busy" | "issuer_not_authorized" }
> {
  if (!looksLikeIntakeToken(rawToken)) return { ok: false, reason: "not_found" };
  const tokenHash = hashIntakeToken(rawToken);

  const [existing] = await sql()`select id,status from client_import_links where token_hash=${tokenHash}`;
  if (!existing) return { ok: false, reason: "not_found" };

  const [claimed] = await sql()`
    update client_import_links
    set status='PROCESSING',processing_started_at=now()
    where token_hash=${tokenHash}
      and expires_at > now()
      and (
        status='ACTIVE'
        or (status='PROCESSING'
            and processing_started_at is not null
            and processing_started_at < now() - make_interval(mins => ${INTAKE_LINK_PROCESSING_STALE_MINUTES}))
      )
    returning id,issued_by`;

  if (!claimed) {
    if (existing.status === "USED" || existing.status === "REVOKED") return { ok: false, reason: "gone" };
    if (existing.status === "PROCESSING") return { ok: false, reason: "busy" };
    // ACTIVE but the UPDATE matched nothing: the link has expired.
    return { ok: false, reason: "gone" };
  }

  const [staff] = await sql()`
    select id,display_name,email,role,auth_user_id,active
    from staff where id=${claimed.issued_by as string}`;
  if (!staff || staff.active !== true || !management(String(staff.role))) {
    // The issuer can no longer act, so the link cannot stage anything. Release
    // it rather than leaving it stuck in PROCESSING.
    await releaseIntakeLink(String(claimed.id));
    return { ok: false, reason: "issuer_not_authorized" };
  }

  return {
    ok: true,
    link: {
      id: String(claimed.id),
      tokenHash,
      // The existing staging pipeline requires a manager or admin actor, so the
      // submission is attributed to the staff member who issued the link.
      issuer: {
        authUserId: String(staff.auth_user_id ?? ""),
        staff: {
          id: String(staff.id),
          display_name: String(staff.display_name),
          email: (staff.email as string | null) ?? null,
          role: String(staff.role) as StaffSession["staff"]["role"],
        },
      },
    },
  };
}

/** Marks the link spent against the case its submission produced. Terminal. */
export async function finalizeIntakeLink(linkId: string, importCaseId: string) {
  const [row] = await sql()`
    update client_import_links
    set status='USED',used_at=now(),import_case_id=${importCaseId},processing_started_at=null
    where id=${linkId} and status='PROCESSING'
    returning id,status`;
  if (row) return true;
  // Another attempt may already have finalized the same case; that is success.
  const [current] = await sql()`select status,import_case_id from client_import_links where id=${linkId}`;
  return current?.status === "USED" && current.import_case_id === importCaseId;
}

/** Returns a link to ACTIVE after a failed submission, so the client may retry. */
export async function releaseIntakeLink(linkId: string) {
  await sql()`
    update client_import_links
    set status='ACTIVE',processing_started_at=null
    where id=${linkId} and status='PROCESSING' and expires_at > now()`;
}

/**
 * The canonical label the existing deterministic parser reads each field under.
 * These are aliases it already accepts, so the composed text needs no change to
 * the staging contract or the parser.
 */
const CANONICAL_LABEL: Record<ClientEditableField, string> = {
  full_name: "Full Name",
  phone: "Phone",
  email: "Email",
  date_of_birth: "Date of Birth",
  street: "Street",
  city: "City",
  state: "State",
  zip: "Zip",
  preferred_language: "Preferred Language",
  english_proficiency: "English Proficiency",
};

/**
 * Composes the source text the submission stages.
 *
 * The client's own corrections are written first, as canonical labelled lines,
 * and the text they typed follows unchanged. The existing parser takes the first
 * labelled match for a field, so a correction wins over whatever was detected in
 * the free text — without a second persistence model and without touching the
 * parser, which stays authoritative for everything else.
 */
export function composeIntakeSource(sourceText: string, edits: Partial<Record<ClientEditableField, string | null>>) {
  const lines: string[] = [];
  for (const field of CLIENT_EDITABLE_FIELDS) {
    const value = (edits[field] ?? "").trim();
    if (!value) continue;
    // A newline in a value would forge an extra labelled line.
    lines.push(`${CANONICAL_LABEL[field]}: ${value.replace(/[\r\n]+/g, " ").trim()}`);
  }
  const original = sourceText.trim();
  if (!lines.length) return original;
  return original ? `${lines.join("\n")}\n\n${original}` : lines.join("\n");
}

/** Constant-time digest comparison, for callers that compare two digests. */
export function sameTokenHash(a: string, b: string) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
