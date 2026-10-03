import "server-only";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { StaffSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import {
  decryptGateJobSecret,
  encryptGateJobSecret,
  ensureGateJobEncryptionReady,
  type EncryptedGateJobSecret,
} from "@/lib/gate-job-account/encryption";
import {
  activeAccountBySource,
  activeAccountForClient,
  clientAudit,
  listAccounts,
  listVault,
  lockAccount,
  lockClient,
  lockVaultEmail,
  releaseExpiredReservations,
  securityAudit,
  vaultCounts,
  type AccountStatus,
  type GateJobAccountSecretRow,
  type GateJobEmailSecretRow,
  type VaultStatus,
} from "@/lib/gate-job-account/repository";
import {
  AddGateJobEmailSchema,
  BulkGateJobEmailSchema,
  UpdateGateJobAccountSchema,
  UpdateGateJobEmailSchema,
  normalizeGateJobEmail,
} from "@/lib/gate-job-account/validation";

type Tx = postgres.TransactionSql;
const RESERVATION_MINUTES = 20;

export class GateJobAccountError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = "GateJobAccountError";
  }
}

function secretFromEmail(row: GateJobEmailSecretRow, field: "password" | "pin"): EncryptedGateJobSecret {
  return field === "password"
    ? { ciphertext: row.password_ciphertext, nonce: row.password_nonce, authTag: row.password_auth_tag, keyVersion: row.encryption_key_version }
    : { ciphertext: row.pin_ciphertext, nonce: row.pin_nonce, authTag: row.pin_auth_tag, keyVersion: row.encryption_key_version };
}

function secretFromAccount(row: GateJobAccountSecretRow, field: "password" | "pin"): EncryptedGateJobSecret {
  return field === "password"
    ? { ciphertext: row.password_ciphertext, nonce: row.password_nonce, authTag: row.password_auth_tag, keyVersion: row.encryption_key_version }
    : { ciphertext: row.pin_ciphertext, nonce: row.pin_nonce, authTag: row.pin_auth_tag, keyVersion: row.encryption_key_version };
}

const emailContext = (id: string, field: "password" | "pin") => `career-gate:gate_job_emails:${id}:${field}:v1`;
const accountContext = (id: string, field: "password" | "pin") => `career-gate:gate_job_accounts:${id}:${field}:v1`;

function assertClientAccess(session: StaffSession, client: Record<string, unknown> | null) {
  if (!client || client.deleted_at) throw new GateJobAccountError("client_not_found", "Client not found", 404);
  if (session.staff.role === "staff" && client.assigned_staff !== session.staff.id) {
    throw new GateJobAccountError("forbidden", "This client is not assigned to you", 403);
  }
}

function assertAccountAccess(session: StaffSession, row: GateJobAccountSecretRow | null) {
  if (!row || (row.client_deleted_at && session.staff.role !== "admin")) throw new GateJobAccountError("not_found", "Gate Job account not found", 404);
  if (session.staff.role === "staff" && row.client_assigned_staff !== session.staff.id) {
    throw new GateJobAccountError("forbidden", "This client is not assigned to you", 403);
  }
}

async function prepareVaultSecrets(id: string, password: string, pin: string) {
  const [passwordSecret, pinSecret] = await Promise.all([
    encryptGateJobSecret(password, emailContext(id, "password")),
    encryptGateJobSecret(pin, emailContext(id, "pin")),
  ]);
  return { passwordSecret, pinSecret };
}

async function insertPreparedEmail(
  tx: Tx,
  session: StaffSession,
  traceId: string,
  input: { id: string; email: string; passwordSecret: EncryptedGateJobSecret; pinSecret: EncryptedGateJobSecret },
  event = "email_created",
) {
  const [row] = await tx`
    insert into gate_job_emails (
      id,email,password_ciphertext,password_nonce,password_auth_tag,pin_ciphertext,pin_nonce,pin_auth_tag,
      encryption_key_version,status,created_by
    ) values (
      ${input.id},${input.email},${input.passwordSecret.ciphertext},${input.passwordSecret.nonce},${input.passwordSecret.authTag},
      ${input.pinSecret.ciphertext},${input.pinSecret.nonce},${input.pinSecret.authTag},${input.passwordSecret.keyVersion},'AVAILABLE',${session.staff.id}
    ) returning id,email,status,created_at,updated_at`;
  await securityAudit(tx, event, session.staff.id, traceId, { record_id: input.id, status: "AVAILABLE" });
  return row;
}

export async function getGateJobVault(session: StaffSession, q: string, status: VaultStatus | "ALL", traceId: string) {
  const db = sql();
  return db.begin(async (tx) => {
    await releaseExpiredReservations(tx, traceId);
    const [emails, counts] = await Promise.all([listVault(tx, q, status), vaultCounts(tx)]);
    return { emails, counts };
  });
}

export async function addGateJobEmail(session: StaffSession, raw: unknown, traceId: string, event = "email_created") {
  const input = AddGateJobEmailSchema.parse(raw);
  await ensureGateJobEncryptionReady();
  const id = randomUUID();
  const secrets = await prepareVaultSecrets(id, input.password, input.pin);
  return sql().begin((tx) => insertPreparedEmail(tx, session, traceId, { id, email: input.email, ...secrets }, event));
}

type BulkResult = { index: number; email: string; status: "VALID" | "DUPLICATE" | "INVALID"; message?: string };

async function classifyBulk(tx: Tx, rows: { email: string; password: string; pin: string }[]) {
  const parsed = rows.map((row) => AddGateJobEmailSchema.safeParse(row));
  const normalized = parsed.flatMap((result) => result.success ? [result.data.email] : []);
  const existing = normalized.length
    ? await tx`select email_normalized from gate_job_emails where email_normalized = any(${normalized}::text[])`
    : [];
  const existingSet = new Set(existing.map((row) => String(row.email_normalized)));
  const seen = new Set<string>();
  const results: BulkResult[] = parsed.map((result, index) => {
    const rawEmail = rows[index]?.email ?? "";
    if (!result.success) return { index, email: normalizeGateJobEmail(rawEmail), status: "INVALID", message: result.error.issues[0]?.message ?? "Invalid row" };
    const email = result.data.email;
    if (existingSet.has(email) || seen.has(email)) return { index, email, status: "DUPLICATE", message: "Email already exists" };
    seen.add(email);
    return { index, email, status: "VALID" };
  });
  return { parsed, results };
}

export async function bulkGateJobEmails(session: StaffSession, raw: unknown, traceId: string) {
  const input = BulkGateJobEmailSchema.parse(raw);
  await ensureGateJobEncryptionReady();
  return sql().begin(async (tx) => {
    const classified = await classifyBulk(tx, input.rows);
    if (input.mode === "preview") return { rows: classified.results, inserted: 0 };
    if (classified.results.some((row) => row.status !== "VALID")) return { rows: classified.results, inserted: 0 };

    const prepared = await Promise.all(classified.parsed.map(async (result) => {
      if (!result.success) throw new GateJobAccountError("invalid_input", "Invalid bulk row");
      const id = randomUUID();
      const secrets = await prepareVaultSecrets(id, result.data.password, result.data.pin);
      return { id, email: result.data.email, ...secrets };
    }));
    for (const item of prepared) await insertPreparedEmail(tx, session, traceId, item, "email_bulk_created");
    return { rows: classified.results, inserted: prepared.length };
  });
}

export async function updateGateJobEmail(session: StaffSession, raw: unknown, traceId: string) {
  const input = UpdateGateJobEmailSchema.parse(raw);
  await ensureGateJobEncryptionReady();
  return sql().begin(async (tx) => {
    const row = await lockVaultEmail(tx, input.id);
    if (!row) throw new GateJobAccountError("not_found", "Gate Job email not found", 404);
    const password = input.password ? await encryptGateJobSecret(input.password, emailContext(row.id, "password")) : null;
    const pin = input.pin ? await encryptGateJobSecret(input.pin, emailContext(row.id, "pin")) : null;
    const [updated] = await tx`
      update gate_job_emails set
        email=coalesce(${input.email ?? null},email),
        password_ciphertext=coalesce(${password?.ciphertext ?? null},password_ciphertext),
        password_nonce=coalesce(${password?.nonce ?? null},password_nonce),
        password_auth_tag=coalesce(${password?.authTag ?? null},password_auth_tag),
        pin_ciphertext=coalesce(${pin?.ciphertext ?? null},pin_ciphertext),
        pin_nonce=coalesce(${pin?.nonce ?? null},pin_nonce),
        pin_auth_tag=coalesce(${pin?.authTag ?? null},pin_auth_tag),
        encryption_key_version=coalesce(${password?.keyVersion ?? pin?.keyVersion ?? null},encryption_key_version),
        updated_by=${session.staff.id}
      where id=${row.id}
      returning id,email,status,created_at,updated_at`;
    await securityAudit(tx, "email_updated", session.staff.id, traceId, {
      record_id: row.id,
      email_changed: input.email !== undefined,
      password_changed: Boolean(password),
      pin_changed: Boolean(pin),
    });
    return updated;
  });
}

export async function deleteGateJobEmail(session: StaffSession, id: string, traceId: string) {
  return sql().begin(async (tx) => {
    const row = await lockVaultEmail(tx, id);
    if (!row) return { deleted: false, id };
    if (row.status !== "AVAILABLE") throw new GateJobAccountError("invalid_state", "Only AVAILABLE emails can be deleted", 409);
    const [dependency] = await tx`select id from gate_job_accounts where source_email_id=${id} limit 1`;
    if (dependency) throw new GateJobAccountError("has_history", "This email has assignment history and cannot be deleted", 409);
    await tx`delete from gate_job_emails where id=${id}`;
    await securityAudit(tx, "email_deleted", session.staff.id, traceId, { record_id: id });
    return { deleted: true, id };
  });
}

export async function revealGateJobEmail(session: StaffSession, id: string, field: "password" | "pin", intent: "reveal" | "copy", traceId: string) {
  await ensureGateJobEncryptionReady();
  return sql().begin(async (tx) => {
    const row = await lockVaultEmail(tx, id);
    if (!row) throw new GateJobAccountError("not_found", "Gate Job email not found", 404);
    const value = await decryptGateJobSecret(secretFromEmail(row, field), emailContext(row.id, field));
    await securityAudit(tx, intent === "copy" ? "credential_copied" : "credential_revealed", session.staff.id, traceId, {
      record_id: row.id,
      credential_type: field,
      source: "gate_job_email_vault",
    });
    return value;
  });
}

export async function reserveGateJobEmail(session: StaffSession, emailId: string, clientId: string, traceId: string) {
  return sql().begin(async (tx) => {
    await releaseExpiredReservations(tx, traceId);
    const client = await lockClient(tx, clientId);
    assertClientAccess(session, client);
    if (await activeAccountForClient(tx, clientId)) throw new GateJobAccountError("client_has_account", "Client already has an active Gate Job account", 409);
    const row = await lockVaultEmail(tx, emailId);
    if (!row) throw new GateJobAccountError("not_found", "Gate Job email not found", 404);
    if (row.status === "USED") throw new GateJobAccountError("email_used", "This Gate Job email has already been used", 409);
    if (row.status === "RESERVED") {
      if (row.reserved_by !== session.staff.id) throw new GateJobAccountError("email_reserved", "This Gate Job email is reserved by another staff member", 409);
      return { id: row.id, status: row.status, reservation_expires_at: row.reservation_expires_at };
    }
    const [reserved] = await tx`
      update gate_job_emails set status='RESERVED',reserved_by=${session.staff.id},reserved_at=now(),
        reservation_expires_at=now()+(${RESERVATION_MINUTES}::text || ' minutes')::interval,updated_by=${session.staff.id}
      where id=${row.id} and status='AVAILABLE'
      returning id,status,reservation_expires_at`;
    if (!reserved) throw new GateJobAccountError("email_unavailable", "Gate Job email is no longer available", 409);
    await securityAudit(tx, "email_reserved", session.staff.id, traceId, { record_id: row.id, client_id: clientId });
    return reserved;
  });
}

export async function releaseGateJobEmail(session: StaffSession, emailId: string, traceId: string) {
  return sql().begin(async (tx) => {
    const row = await lockVaultEmail(tx, emailId);
    if (!row || row.status === "AVAILABLE") return { id: emailId, status: "AVAILABLE" as const };
    if (row.status === "USED") throw new GateJobAccountError("email_used", "USED emails cannot be released", 409);
    if (row.reserved_by !== session.staff.id && session.staff.role === "staff") {
      throw new GateJobAccountError("forbidden", "This reservation belongs to another staff member", 403);
    }
    const [released] = await tx`
      update gate_job_emails set status='AVAILABLE',reserved_by=null,reserved_at=null,reservation_expires_at=null,updated_by=${session.staff.id}
      where id=${row.id} returning id,status`;
    await securityAudit(tx, "email_released", session.staff.id, traceId, { record_id: row.id });
    return released;
  });
}

export async function confirmGateJobAssignment(session: StaffSession, emailId: string, clientId: string, traceId: string) {
  await ensureGateJobEncryptionReady();
  return sql().begin(async (tx) => {
    await releaseExpiredReservations(tx, traceId);
    const client = await lockClient(tx, clientId);
    assertClientAccess(session, client);
    if (await activeAccountForClient(tx, clientId)) throw new GateJobAccountError("client_has_account", "Client already has an active Gate Job account", 409);

    const source = await lockVaultEmail(tx, emailId);
    if (!source) throw new GateJobAccountError("not_found", "Gate Job email not found", 404);
    if (source.status !== "RESERVED" || source.reserved_by !== session.staff.id || !source.reservation_expires_at || source.reservation_expires_at.getTime() <= Date.now()) {
      throw new GateJobAccountError("invalid_reservation", "Gate Job email reservation is missing or expired", 409);
    }
    if (await activeAccountBySource(tx, source.id)) throw new GateJobAccountError("email_assigned", "Gate Job email already backs an active account", 409);

    const [password, pin] = await Promise.all([
      decryptGateJobSecret(secretFromEmail(source, "password"), emailContext(source.id, "password")),
      decryptGateJobSecret(secretFromEmail(source, "pin"), emailContext(source.id, "pin")),
    ]);
    const accountId = randomUUID();
    const [passwordSnapshot, pinSnapshot] = await Promise.all([
      encryptGateJobSecret(password, accountContext(accountId, "password")),
      encryptGateJobSecret(pin, accountContext(accountId, "pin")),
    ]);

    const [account] = await tx`
      insert into gate_job_accounts (
        id,assigned_to_client_id,source_email_id,email_snapshot,password_ciphertext,password_nonce,password_auth_tag,
        pin_ciphertext,pin_nonce,pin_auth_tag,encryption_key_version,status,assigned_by
      ) values (
        ${accountId},${clientId},${source.id},${source.email},${passwordSnapshot.ciphertext},${passwordSnapshot.nonce},${passwordSnapshot.authTag},
        ${pinSnapshot.ciphertext},${pinSnapshot.nonce},${pinSnapshot.authTag},${passwordSnapshot.keyVersion},'PENDING',${session.staff.id}
      ) returning id,assigned_to_client_id,source_email_id,email_snapshot,status,assigned_at,ready_at,updated_at,removed_at`;

    await tx`
      update gate_job_emails set status='USED',reserved_by=null,reserved_at=null,reservation_expires_at=null,updated_by=${session.staff.id}
      where id=${source.id}`;

    await securityAudit(tx, "email_used", session.staff.id, traceId, { record_id: source.id, client_id: clientId, account_id: accountId });
    await clientAudit(tx, { clientId, action: "gate_job_account_assigned", staffId: session.staff.id, traceId, entityId: accountId, detail: { source_email_id: source.id, status: "PENDING" } });
    return account;
  });
}

export async function getGateJobAccounts(session: StaffSession, q: string, status: AccountStatus | "ALL", traceId: string) {
  return sql().begin(async (tx) => {
    await releaseExpiredReservations(tx, traceId);
    return listAccounts(tx, session, q, status);
  });
}

export async function getGateJobAccountForClient(session: StaffSession, clientId: string) {
  return sql().begin(async (tx) => {
    const client = await lockClient(tx, clientId);
    assertClientAccess(session, client);
    const account = await activeAccountForClient(tx, clientId);
    if (!account) return null;
    return {
      id: account.id,
      assigned_to_client_id: account.assigned_to_client_id,
      email_snapshot: account.email_snapshot,
      status: account.status,
      assigned_at: account.assigned_at,
      ready_at: account.ready_at,
      updated_at: account.updated_at,
    };
  });
}

export async function markGateJobAccountReady(session: StaffSession, accountId: string, traceId: string) {
  return sql().begin(async (tx) => {
    const row = await lockAccount(tx, accountId);
    assertAccountAccess(session, row);
    if (!row) throw new GateJobAccountError("not_found", "Gate Job account not found", 404);
    if (row.status === "READY") return row;
    if (row.status !== "PENDING") throw new GateJobAccountError("invalid_state", "Only PENDING accounts can be marked READY", 409);
    const [updated] = await tx`
      update gate_job_accounts set status='READY',ready_by=${session.staff.id},ready_at=now(),updated_by=${session.staff.id}
      where id=${row.id}
      returning id,assigned_to_client_id,email_snapshot,status,assigned_at,ready_at,updated_at,removed_at`;
    await clientAudit(tx, { clientId: row.assigned_to_client_id, action: "gate_job_account_ready", staffId: session.staff.id, traceId, entityId: row.id, detail: { status: "READY" } });
    return updated;
  });
}

export async function updateGateJobAccount(session: StaffSession, raw: unknown, traceId: string) {
  const input = UpdateGateJobAccountSchema.parse(raw);
  await ensureGateJobEncryptionReady();
  return sql().begin(async (tx) => {
    const row = await lockAccount(tx, input.account_id);
    assertAccountAccess(session, row);
    if (!row) throw new GateJobAccountError("not_found", "Gate Job account not found", 404);
    if (row.status === "DISABLED") throw new GateJobAccountError("invalid_state", "Disabled Gate Job accounts cannot be edited", 409);
    const password = input.password ? await encryptGateJobSecret(input.password, accountContext(row.id, "password")) : null;
    const pin = input.pin ? await encryptGateJobSecret(input.pin, accountContext(row.id, "pin")) : null;
    const [updated] = await tx`
      update gate_job_accounts set
        email_snapshot=coalesce(${input.email ?? null},email_snapshot),
        password_ciphertext=coalesce(${password?.ciphertext ?? null},password_ciphertext),
        password_nonce=coalesce(${password?.nonce ?? null},password_nonce),
        password_auth_tag=coalesce(${password?.authTag ?? null},password_auth_tag),
        pin_ciphertext=coalesce(${pin?.ciphertext ?? null},pin_ciphertext),
        pin_nonce=coalesce(${pin?.nonce ?? null},pin_nonce),
        pin_auth_tag=coalesce(${pin?.authTag ?? null},pin_auth_tag),
        encryption_key_version=coalesce(${password?.keyVersion ?? pin?.keyVersion ?? null},encryption_key_version),
        updated_by=${session.staff.id}
      where id=${row.id}
      returning id,assigned_to_client_id,email_snapshot,status,assigned_at,ready_at,updated_at,removed_at`;
    await clientAudit(tx, {
      clientId: row.assigned_to_client_id,
      action: "gate_job_account_updated",
      staffId: session.staff.id,
      traceId,
      entityId: row.id,
      detail: { email_changed: input.email !== undefined, password_changed: Boolean(password), pin_changed: Boolean(pin) },
    });
    return updated;
  });
}

export async function removeGateJobAccount(session: StaffSession, accountId: string, traceId: string) {
  return sql().begin(async (tx) => {
    const row = await lockAccount(tx, accountId);
    assertAccountAccess(session, row);
    if (!row) throw new GateJobAccountError("not_found", "Gate Job account not found", 404);
    if (row.status === "DISABLED") return row;
    const [updated] = await tx`
      update gate_job_accounts set status='DISABLED',removed_by=${session.staff.id},removed_at=now(),updated_by=${session.staff.id}
      where id=${row.id}
      returning id,assigned_to_client_id,email_snapshot,status,assigned_at,ready_at,updated_at,removed_at`;
    await clientAudit(tx, { clientId: row.assigned_to_client_id, action: "gate_job_account_disabled", staffId: session.staff.id, traceId, entityId: row.id, detail: { status: "DISABLED" } });
    return updated;
  });
}

export async function revealGateJobAccount(session: StaffSession, accountId: string, field: "password" | "pin", intent: "reveal" | "copy", traceId: string) {
  await ensureGateJobEncryptionReady();
  return sql().begin(async (tx) => {
    const row = await lockAccount(tx, accountId);
    assertAccountAccess(session, row);
    if (!row) throw new GateJobAccountError("not_found", "Gate Job account not found", 404);
    if (row.status === "DISABLED") throw new GateJobAccountError("invalid_state", "Disabled Gate Job account credentials cannot be revealed", 409);
    const value = await decryptGateJobSecret(secretFromAccount(row, field), accountContext(row.id, field));
    await clientAudit(tx, {
      clientId: row.assigned_to_client_id,
      action: intent === "copy" ? "credential_copied" : "credential_revealed",
      staffId: session.staff.id,
      traceId,
      entityId: row.id,
      detail: { credential_type: field, source: "gate_job_account" },
    });
    return value;
  });
}

export async function expireGateJobReservations(traceId: string) {
  return sql().begin((tx) => releaseExpiredReservations(tx, traceId));
}
