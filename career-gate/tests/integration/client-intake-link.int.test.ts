import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { StaffSession } from "@/lib/auth";
import {
  claimIntakeLink,
  finalizeIntakeLink,
  hashIntakeToken,
  INTAKE_LINK_MAX_TTL_HOURS,
  INTAKE_LINK_PROCESSING_STALE_MINUTES,
  intakeIdempotencyKey,
  issueIntakeLink,
  listIntakeLinks,
  mintIntakeToken,
  readIntakeLinkForClient,
  releaseIntakeLink,
  revokeIntakeLink,
} from "@/lib/client-intake-link";

/**
 * The one-time link lifecycle, against the real schema.
 *
 * Every test uses synthetic data. Nothing here exercises the live Smart staging
 * pipeline's storage side; the staging call itself is covered by the existing
 * smart-client-import suite and is deliberately not duplicated.
 */

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

let manager: StaffSession;
let admin: StaffSession;
let plainStaff: StaffSession;

async function makeStaff(key: string, role: "admin" | "manager" | "staff"): Promise<StaffSession> {
  const authUserId = randomUUID();
  await db`insert into auth.users (id,email) values (${authUserId},${`${key}@test.invalid`})`;
  const [staff] = await db`
    insert into staff (display_name,email,role,auth_user_id,active)
    values (${`TEST ${key}`},${`${key}@test.invalid`},${role},${authUserId},true)
    returning id,display_name,email,role`;
  return { authUserId, staff: staff as StaffSession["staff"] };
}

/** A synthetic import case, so a link can be finalized against a real row. */
async function makeImportCase(staffId: string) {
  const [batch] = await db`
    insert into client_import_batches(source_type,source_file_hash,idempotency_key,created_by,metadata)
    values('mobile',${createHash("sha256").update(randomUUID()).digest("hex")},${`qa-intake-${randomUUID()}`},${staffId},${db.json({})})
    returning id`;
  const [row] = await db`
    insert into client_import_cases(batch_id,source_type,status,raw_input,mapped_draft,missing_fields,conflicts,field_evidence,verification_result,created_by)
    values(${batch.id},'mobile','PENDING',${db.json({ notes: "qa synthetic" })},${db.json({})},${db.json([])},
           ${db.json([])},${db.json([])},${db.json({})},${staffId})
    returning id`;
  return String(row.id);
}

beforeAll(async () => {
  manager = await makeStaff("intake-manager", "manager");
  admin = await makeStaff("intake-admin", "admin");
  plainStaff = await makeStaff("intake-staff", "staff");
});

afterAll(async () => { await db.end(); });

describe("the table protects the invariants, not only the code", () => {
  it("enables RLS and denies anon and authenticated outright", async () => {
    const [table] = await db`
      select c.relrowsecurity rls
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname='client_import_links'`;
    expect(table?.rls).toBe(true);

    for (const role of ["anon", "authenticated"] as const) {
      const grants = await db`
        select privilege_type from information_schema.role_table_grants
        where table_schema='public' and table_name='client_import_links' and grantee=${role}`;
      expect(grants.length, role).toBe(0);
    }
  });

  it("stores only a lowercase SHA-256 digest", async () => {
    const link = await issueIntakeLink(manager, 24);
    const [row] = await db`select token_hash from client_import_links where id=${link.id}`;
    expect(String(row.token_hash)).toMatch(/^[0-9a-f]{64}$/);
    // The raw token is nowhere in the row.
    expect(String(row.token_hash)).not.toBe(link.token);

    await expect(
      db`insert into client_import_links(token_hash,issued_by,expires_at) values('NOT-A-DIGEST',${manager.staff.id},now()+interval '1 hour')`,
    ).rejects.toThrow(/client_import_links_token_hash_ck/);
  });

  it("refuses a USED row without a case, and a REVOKED row without a timestamp", async () => {
    const { tokenHash } = mintIntakeToken();
    const [row] = await db`
      insert into client_import_links(token_hash,issued_by,expires_at)
      values(${tokenHash},${manager.staff.id},now()+interval '1 hour') returning id`;
    await expect(
      db`update client_import_links set status='USED' where id=${row.id}`,
    ).rejects.toThrow(/client_import_links_used_ck/);
    await expect(
      db`update client_import_links set status='REVOKED' where id=${row.id}`,
    ).rejects.toThrow(/client_import_links_revoked_ck/);
  });

  it("refuses an unknown status and a duplicate digest", async () => {
    const { tokenHash } = mintIntakeToken();
    await db`insert into client_import_links(token_hash,issued_by,expires_at) values(${tokenHash},${manager.staff.id},now()+interval '1 hour')`;
    await expect(
      db`insert into client_import_links(token_hash,issued_by,expires_at) values(${tokenHash},${manager.staff.id},now()+interval '1 hour')`,
    ).rejects.toThrow(/client_import_links_token_hash_key/);
    const { tokenHash: other } = mintIntakeToken();
    await expect(
      db`insert into client_import_links(token_hash,issued_by,expires_at,status) values(${other},${manager.staff.id},now()+interval '1 hour','SOMETHING')`,
    ).rejects.toThrow(/client_import_links_status_ck/);
  });
});

describe("issuing and revoking", () => {
  it("lets an admin and a manager issue, and refuses plain staff", async () => {
    expect((await issueIntakeLink(admin, 24)).status).toBe("ACTIVE");
    expect((await issueIntakeLink(manager, 24)).status).toBe("ACTIVE");
    await expect(issueIntakeLink(plainStaff, 24)).rejects.toThrow("Client intake links require manager or admin access");
    await expect(listIntakeLinks(plainStaff)).rejects.toThrow("manager or admin");
  });

  it("defaults to 24 hours and refuses more than the maximum", async () => {
    const link = await issueIntakeLink(manager, 24);
    const hours = (new Date(link.expires_at).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);

    const longest = await issueIntakeLink(manager, INTAKE_LINK_MAX_TTL_HOURS);
    expect((new Date(longest.expires_at).getTime() - Date.now()) / 3_600_000).toBeGreaterThan(167);

    await expect(issueIntakeLink(manager, INTAKE_LINK_MAX_TTL_HOURS + 1)).rejects.toThrow("Expiry must be between");
    await expect(issueIntakeLink(manager, 0)).rejects.toThrow("Expiry must be between");
  });

  it("never returns a token again after issuing", async () => {
    const link = await issueIntakeLink(manager, 24);
    const listed = await listIntakeLinks(manager);
    const entry = listed.find((item) => item.id === link.id);
    expect(entry).toBeTruthy();
    expect(JSON.stringify(entry)).not.toContain(link.token);
  });

  it("revokes an active link and refuses to revoke a used one", async () => {
    const link = await issueIntakeLink(manager, 24);
    expect((await revokeIntakeLink(manager, link.id)).status).toBe("REVOKED");
    // Idempotent.
    expect((await revokeIntakeLink(manager, link.id)).status).toBe("REVOKED");

    const used = await issueIntakeLink(manager, 24);
    const claim = await claimIntakeLink(used.token);
    expect(claim.ok).toBe(true);
    if (claim.ok) expect(await finalizeIntakeLink(claim.link.id, await makeImportCase(manager.staff.id))).toBe(true);
    await expect(revokeIntakeLink(manager, used.id)).rejects.toThrow("A used link cannot be revoked");
  });
});

describe("opening the link never consumes it", () => {
  it("reads as openable repeatedly and leaves the status ACTIVE", async () => {
    const link = await issueIntakeLink(manager, 24);
    for (let i = 0; i < 5; i += 1) {
      expect(await readIntakeLinkForClient(link.token)).toEqual({ ok: true, openable: true });
    }
    const [row] = await db`select status,processing_started_at,used_at from client_import_links where id=${link.id}`;
    expect(row.status).toBe("ACTIVE");
    expect(row.processing_started_at).toBeNull();
    expect(row.used_at).toBeNull();
  });

  it("reports an unknown token as not found and a spent one as gone", async () => {
    expect(await readIntakeLinkForClient(mintIntakeToken().token)).toEqual({ ok: false, reason: "not_found" });
    expect(await readIntakeLinkForClient("../etc/passwd")).toEqual({ ok: false, reason: "not_found" });

    const revoked = await issueIntakeLink(manager, 24);
    await revokeIntakeLink(manager, revoked.id);
    expect(await readIntakeLinkForClient(revoked.token)).toEqual({ ok: false, reason: "gone" });

    const expired = await issueIntakeLink(manager, 24);
    await db`update client_import_links set expires_at=now()-interval '1 minute' where id=${expired.id}`;
    expect(await readIntakeLinkForClient(expired.token)).toEqual({ ok: false, reason: "gone" });
  });
});

describe("claiming is exclusive and only success consumes the link", () => {
  it("claims an active link once and refuses a concurrent second claim", async () => {
    const link = await issueIntakeLink(manager, 24);
    const [first, second] = await Promise.all([claimIntakeLink(link.token), claimIntakeLink(link.token)]);
    const wins = [first, second].filter((r) => r.ok);
    const losses = [first, second].filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    expect(losses[0].ok === false && losses[0].reason).toBe("busy");
  });

  it("returns the issuing staff member as the actor the pipeline requires", async () => {
    const link = await issueIntakeLink(manager, 24);
    const claim = await claimIntakeLink(link.token);
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.link.issuer.staff.id).toBe(manager.staff.id);
    expect(claim.link.issuer.staff.role).toBe("manager");
    expect(claim.link.tokenHash).toBe(hashIntakeToken(link.token));
  });

  it("refuses an expired, revoked or already used link", async () => {
    const expired = await issueIntakeLink(manager, 24);
    await db`update client_import_links set expires_at=now()-interval '1 minute' where id=${expired.id}`;
    expect((await claimIntakeLink(expired.token)) as { reason?: string }).toMatchObject({ ok: false, reason: "gone" });

    const revoked = await issueIntakeLink(manager, 24);
    await revokeIntakeLink(manager, revoked.id);
    expect((await claimIntakeLink(revoked.token)) as { reason?: string }).toMatchObject({ ok: false, reason: "gone" });

    const used = await issueIntakeLink(manager, 24);
    const claim = await claimIntakeLink(used.token);
    if (claim.ok) await finalizeIntakeLink(claim.link.id, await makeImportCase(manager.staff.id));
    expect((await claimIntakeLink(used.token)) as { reason?: string }).toMatchObject({ ok: false, reason: "gone" });
  });

  it("refuses to stage when the issuer is no longer an active manager or admin", async () => {
    const demoted = await makeStaff(`intake-demoted-${randomUUID().slice(0, 8)}`, "manager");
    const link = await issueIntakeLink(demoted, 24);
    await db`update staff set active=false where id=${demoted.staff.id}`;
    const claim = await claimIntakeLink(link.token);
    expect(claim).toMatchObject({ ok: false, reason: "issuer_not_authorized" });
    // The link was released, not left stuck in PROCESSING.
    const [row] = await db`select status from client_import_links where id=${link.id}`;
    expect(row.status).toBe("ACTIVE");

    const roleDropped = await makeStaff(`intake-rolechange-${randomUUID().slice(0, 8)}`, "manager");
    const second = await issueIntakeLink(roleDropped, 24);
    await db`update staff set role='staff' where id=${roleDropped.staff.id}`;
    expect(await claimIntakeLink(second.token)).toMatchObject({ ok: false, reason: "issuer_not_authorized" });
  });

  it("a failed submission releases the link so the client can retry", async () => {
    const link = await issueIntakeLink(manager, 24);
    const claim = await claimIntakeLink(link.token);
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    await releaseIntakeLink(claim.link.id);
    const [row] = await db`select status,processing_started_at,used_at from client_import_links where id=${link.id}`;
    expect(row.status).toBe("ACTIVE");
    expect(row.processing_started_at).toBeNull();
    expect(row.used_at).toBeNull();
    // And it can be claimed again.
    expect((await claimIntakeLink(link.token)).ok).toBe(true);
  });

  it("recovers a PROCESSING state abandoned longer than the stale window", async () => {
    const link = await issueIntakeLink(manager, 24);
    const first = await claimIntakeLink(link.token);
    expect(first.ok).toBe(true);
    // Still fresh: nobody else may take it.
    expect(await claimIntakeLink(link.token)).toMatchObject({ ok: false, reason: "busy" });

    await db`
      update client_import_links
      set processing_started_at=now() - make_interval(mins => ${INTAKE_LINK_PROCESSING_STALE_MINUTES + 1})
      where id=${link.id}`;
    const recovered = await claimIntakeLink(link.token);
    expect(recovered.ok).toBe(true);

    // The recovery reuses the same deterministic key, so the retry would reach
    // the same staged case rather than creating a second one.
    if (first.ok && recovered.ok) {
      expect(intakeIdempotencyKey(recovered.link.tokenHash)).toBe(intakeIdempotencyKey(first.link.tokenHash));
    }
  });

  it("finalizes exactly once and stays USED forever", async () => {
    const link = await issueIntakeLink(manager, 24);
    const claim = await claimIntakeLink(link.token);
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    const caseId = await makeImportCase(manager.staff.id);

    expect(await finalizeIntakeLink(claim.link.id, caseId)).toBe(true);
    const [row] = await db`select status,used_at,import_case_id,processing_started_at from client_import_links where id=${link.id}`;
    expect(row.status).toBe("USED");
    expect(row.used_at).toBeTruthy();
    expect(row.import_case_id).toBe(caseId);
    expect(row.processing_started_at).toBeNull();

    // A repeat finalize for the same case is reported as success, not a change.
    expect(await finalizeIntakeLink(claim.link.id, caseId)).toBe(true);
    // A finalize for a different case is refused.
    expect(await finalizeIntakeLink(claim.link.id, await makeImportCase(manager.staff.id))).toBe(false);
    // Releasing a USED link does nothing: it can never return to ACTIVE.
    await releaseIntakeLink(claim.link.id);
    const [after] = await db`select status from client_import_links where id=${link.id}`;
    expect(after.status).toBe("USED");
  });

  it("creates no duplicate import case across a stale recovery", async () => {
    const link = await issueIntakeLink(manager, 24);
    const first = await claimIntakeLink(link.token);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // A crash after staging but before USED: the case exists, the link is stuck.
    const caseId = await makeImportCase(manager.staff.id);
    await db`
      update client_import_links
      set processing_started_at=now() - make_interval(mins => ${INTAKE_LINK_PROCESSING_STALE_MINUTES + 1})
      where id=${link.id}`;

    const recovered = await claimIntakeLink(link.token);
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    // The recovery finalizes against the SAME case the first attempt staged.
    expect(await finalizeIntakeLink(recovered.link.id, caseId)).toBe(true);

    const [{ count }] = await db`select count(*)::int count from client_import_links where import_case_id=${caseId}`;
    expect(count).toBe(1);
  });
});
