import "server-only";
import type postgres from "postgres";
import type { StaffSession } from "@/lib/auth";

type Db = postgres.Sql | postgres.TransactionSql;
export type VaultStatus = "AVAILABLE" | "RESERVED" | "USED";
export type AccountStatus = "PENDING" | "READY" | "DISABLED";

export type AmazonEmailSecretRow = {
  id: string;
  email: string;
  email_normalized: string;
  password_ciphertext: string;
  password_nonce: string;
  password_auth_tag: string;
  pin_ciphertext: string;
  pin_nonce: string;
  pin_auth_tag: string;
  encryption_key_version: string;
  status: VaultStatus;
  reserved_by: string | null;
  reserved_at: Date | null;
  reservation_expires_at: Date | null;
  updated_at: Date;
};

export type AmazonAccountSecretRow = {
  id: string;
  assigned_to_client_id: string;
  source_email_id: string;
  email_snapshot: string;
  password_ciphertext: string;
  password_nonce: string;
  password_auth_tag: string;
  pin_ciphertext: string;
  pin_nonce: string;
  pin_auth_tag: string;
  encryption_key_version: string;
  status: AccountStatus;
  assigned_by: string;
  assigned_at: Date;
  ready_by: string | null;
  ready_at: Date | null;
  updated_by: string | null;
  updated_at: Date;
  removed_by: string | null;
  removed_at: Date | null;
  created_at: Date;
  client_name?: string;
  client_ref?: string;
  client_assigned_staff?: string | null;
  client_deleted_at?: Date | null;
};

export async function securityAudit(
  tx: Db,
  event: string,
  staffId: string | null,
  traceId: string,
  detail: Record<string, unknown>,
) {
  await tx`insert into security_events (event, staff_id, detail, trace_id)
           values (${event}, ${staffId}, ${tx.json(detail as never)}, ${traceId})`;
}

export async function clientAudit(
  tx: Db,
  args: { clientId: string; action: string; staffId: string; traceId: string; entityId: string; detail?: Record<string, unknown> },
) {
  await tx`insert into activity_log (client_id, action, staff_id, entity_type, entity_id, new_value, trace_id)
           values (${args.clientId}, ${args.action}, ${args.staffId}, 'amazon_account', ${args.entityId},
                   ${tx.json((args.detail ?? {}) as never)}, ${args.traceId})`;
}

export async function releaseExpiredReservations(tx: Db, traceId: string) {
  const rows = await tx`
    update amazon_emails
    set status='AVAILABLE', reserved_by=null, reserved_at=null, reservation_expires_at=null, updated_by=null
    where status='RESERVED' and reservation_expires_at <= now()
    returning id`;
  for (const row of rows) {
    await securityAudit(tx, "email_reservation_expired", null, traceId, { record_id: String(row.id) });
  }
  return rows.length;
}

export async function listVault(tx: Db, q: string, status: VaultStatus | "ALL") {
  const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  return tx`
    select id,email,status,reserved_by,reserved_at,reservation_expires_at,created_at,updated_at
    from amazon_emails
    where (${status === "ALL"} or status=${status})
      and (${q.length === 0} or email_normalized ilike ${pattern})
    order by case status when 'AVAILABLE' then 0 when 'RESERVED' then 1 else 2 end, updated_at desc, email_normalized
    limit 500`;
}

export async function vaultCounts(tx: Db) {
  const [row] = await tx`
    select
      count(*) filter (where status='AVAILABLE')::int as available,
      count(*) filter (where status='RESERVED')::int as reserved,
      count(*) filter (where status='USED')::int as used
    from amazon_emails`;
  return {
    AVAILABLE: Number(row?.available ?? 0),
    RESERVED: Number(row?.reserved ?? 0),
    USED: Number(row?.used ?? 0),
  };
}

export async function lockVaultEmail(tx: Db, id: string) {
  const [row] = await tx`select * from amazon_emails where id=${id} for update`;
  return (row as AmazonEmailSecretRow | undefined) ?? null;
}

export async function listAccounts(tx: Db, session: StaffSession, q: string, status: AccountStatus | "ALL") {
  const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const isAdmin = session.staff.role === "admin";
  const isStaff = session.staff.role === "staff";
  return tx`
    select a.id,a.assigned_to_client_id,a.source_email_id,a.email_snapshot,a.status,a.assigned_at,a.ready_at,a.updated_at,a.removed_at,
           c.full_name as client_name,c.ref as client_ref
    from amazon_accounts a
    join clients c on c.id=a.assigned_to_client_id
    where (${status === "ALL"} or a.status=${status})
      and (${q.length === 0} or lower(a.email_snapshot) ilike ${pattern} or lower(c.full_name) ilike ${pattern} or lower(c.ref) ilike ${pattern})
      and (${isAdmin} or c.deleted_at is null)
      and (${!isStaff} or c.assigned_staff=${session.staff.id})
    order by a.assigned_at desc
    limit 500`;
}

export async function lockAccount(tx: Db, id: string) {
  const [row] = await tx`
    select a.*,c.full_name as client_name,c.ref as client_ref,c.assigned_staff as client_assigned_staff,c.deleted_at as client_deleted_at
    from amazon_accounts a join clients c on c.id=a.assigned_to_client_id
    where a.id=${id}
    for update of a,c`;
  return (row as AmazonAccountSecretRow | undefined) ?? null;
}

export async function activeAccountForClient(tx: Db, clientId: string) {
  const [row] = await tx`
    select a.*,c.full_name as client_name,c.ref as client_ref,c.assigned_staff as client_assigned_staff,c.deleted_at as client_deleted_at
    from amazon_accounts a join clients c on c.id=a.assigned_to_client_id
    where a.assigned_to_client_id=${clientId} and a.status in ('PENDING','READY') and a.removed_at is null
    order by a.assigned_at desc limit 1`;
  return (row as AmazonAccountSecretRow | undefined) ?? null;
}

export async function lockClient(tx: Db, clientId: string) {
  const [row] = await tx`select id,ref,full_name,assigned_staff,deleted_at from clients where id=${clientId} for update`;
  return row ?? null;
}

export async function activeAccountBySource(tx: Db, sourceEmailId: string) {
  const [row] = await tx`select id from amazon_accounts where source_email_id=${sourceEmailId} and status in ('PENDING','READY') and removed_at is null limit 1`;
  return row ?? null;
}
