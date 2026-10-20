import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { sealAuditChain, verifyAuditChain, type ChainHead } from "@/lib/audit-chain";
import { withStaff, type StaffSession } from "@/lib/auth";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";

/**
 * The tamper-evident activity chain (migration 046), against the real schema.
 * Tampering is simulated the only way it can happen: a superuser session that
 * disables the append-only triggers. Every tamper runs inside a transaction
 * that is rolled back, so the shared database keeps a valid chain. Synthetic
 * data only.
 */

const url = process.env.DATABASE_URL!;
const db = postgres(url, { prepare: false, max: 1 });
const trace = "audit-chain-int";
const tag = randomUUID().slice(0, 8);
let clientId = "";
// A range of its own: the integration suites share one database.
let phoneSequence = 9100;
const nextPhone = () => `313557${String(++phoneSequence).padStart(4, "0")}`;

type Tx = postgres.TransactionSql;
class Rollback extends Error {}

async function inRollback(fn: (tx: Tx) => Promise<void>) {
  await expect(db.begin(async (tx) => {
    await fn(tx);
    throw new Rollback();
  })).rejects.toBeInstanceOf(Rollback);
}

async function logRow(note: string, conn: postgres.Sql | Tx = db) {
  const [row] = await conn`
    insert into activity_log (client_id,action,entity_type,entity_id,new_value,trace_id)
    values (${clientId},'note_added','note',${randomUUID()},${conn.json({ note, tag } as never)},${trace})
    returning id`;
  return Number(row.id);
}

async function sealAll() {
  const result = await sealAuditChain({ full: true, maxBatches: 200, traceId: trace });
  expect(result.status).toBe("sealed");
  return result as Extract<typeof result, { status: "sealed" }>;
}

async function verified(opts: { anchor?: ChainHead; limit?: number } = {}) {
  const result = await verifyAuditChain({ traceId: trace, ...opts });
  expect(["schema_pending", "error", "busy"]).not.toContain(result.status);
  return result as Extract<typeof result, { checked: number }>;
}

/** Verification inside a transaction, so it sees that transaction's tampering. */
async function verifyIn(tx: Tx, anchor?: ChainHead) {
  const [row] = await tx`select * from public.cg_audit_verify(1, 1000000, ${anchor?.seq ?? null}, ${anchor?.hash ?? null})`;
  return { reason: row.reason as string | null, firstInvalidSeq: row.first_invalid_seq == null ? null : Number(row.first_invalid_seq) };
}

async function chainHead(conn: postgres.Sql | Tx = db): Promise<ChainHead> {
  const [row] = await conn`select seq, encode(row_hash,'hex') hash from audit_chain order by seq desc limit 1`;
  return { seq: Number(row.seq), hash: String(row.hash) };
}

const disableTriggers = async (tx: Tx) => {
  await tx`alter table activity_log disable trigger activity_log_append_only`;
  await tx`alter table audit_chain disable trigger audit_chain_append_only`;
};

beforeAll(async () => {
  const client = await db.begin((tx) =>
    insertClient(tx, {
      source: "staff_manual",
      profile: ProfileSchema.parse({ full_name: `TEST Audit Chain ${tag}`, phone: nextPhone(), email: null, date_of_birth: "1985-06-07", employment_history: [] }),
      primary: [], backup: [], status: "new_intake" as never, nextStep: null,
      assignedStaff: null, createdBy: null, communicationConsent: true,
    }, { staffId: null, traceId: trace }));
  clientId = String((client as { id: string }).id);
  await sealAll();
});

afterAll(async () => {
  await db.end();
});

describe("audit chain", () => {
  it("seals every activity row and verifies the whole chain up to its head", async () => {
    await logRow("one");
    await logRow("two");
    const seal = await sealAll();
    const v = await verified();
    expect(v).toMatchObject({ status: "verified", firstInvalidSeq: null, reason: null, unsealed: 0 });
    const [{ n }] = await db`select count(*)::int n from activity_log`;
    expect(v.checked).toBe(n);
    expect(v.lastSeq).toBe(v.maxSeq);
    expect(v.head).toEqual(await chainHead());
    expect(seal.head).toEqual(v.head);
    expect(v.head?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic: verifying twice gives the same result", async () => {
    expect(await verified()).toEqual(await verified());
  });

  it("verifies against its own recorded head", async () => {
    const anchor = await chainHead();
    expect(await verified({ anchor })).toMatchObject({ status: "verified", reason: null });
  });

  it("detects an altered sealed row", async () => {
    const id = await logRow("original");
    await sealAll();
    const [{ seq }] = await db`select seq from audit_chain where log_id=${id}`;
    await inRollback(async (tx) => {
      await disableTriggers(tx);
      await tx`update activity_log set new_value=${tx.json({ note: "tampered", tag } as never)} where id=${id}`;
      expect(await verifyIn(tx)).toEqual({ reason: "content_mismatch", firstInvalidSeq: Number(seq) });
    });
    expect((await verified()).status).toBe("verified");
  });

  it("detects a removed seal as a sequence gap", async () => {
    const id = await logRow("gap");
    await logRow("after gap");
    await sealAll();
    const [{ seq }] = await db`select seq from audit_chain where log_id=${id}`;
    await inRollback(async (tx) => {
      await disableTriggers(tx);
      await tx`delete from audit_chain where seq=${seq}`;
      expect(await verifyIn(tx)).toEqual({ reason: "sequence_gap", firstInvalidSeq: Number(seq) });
    });
  });

  it("a rewrite that recomputes every later seal passes the chain alone, and fails against an anchor", async () => {
    const id = await logRow("to rewrite");
    await logRow("later 1");
    await logRow("later 2");
    await sealAll();
    const anchor = await chainHead();
    await inRollback(async (tx) => {
      await disableTriggers(tx);
      await tx`update activity_log set new_value=${tx.json({ note: "rewritten", tag } as never)} where id=${id}`;
      const [{ seq: from }] = await tx`select seq from audit_chain where log_id=${id}`;
      let [{ prev }] = await tx`select prev_hash prev from audit_chain where seq=${from}`;
      for (const link of await tx`select seq, log_id from audit_chain where seq >= ${from} order by seq`) {
        [{ prev }] = await tx`
          update audit_chain set prev_hash=${prev},
            row_hash=(select public.cg_audit_link(${prev}, 1::smallint, l) from activity_log l where l.id=${link.log_id})
          where seq=${link.seq} returning row_hash prev`;
      }
      expect(await verifyIn(tx)).toEqual({ reason: null, firstInvalidSeq: null });
      expect(await verifyIn(tx, anchor)).toEqual({ reason: "anchor_mismatch", firstInvalidSeq: anchor.seq });
    });
  });

  it("removing the newest rows with their seals passes the chain alone, and fails against an anchor", async () => {
    await logRow("newest");
    await sealAll();
    const anchor = await chainHead();
    await inRollback(async (tx) => {
      await disableTriggers(tx);
      const [{ log_id }] = await tx`delete from audit_chain where seq=${anchor.seq} returning log_id`;
      await tx`delete from activity_log where id=${log_id}`;
      expect(await verifyIn(tx)).toEqual({ reason: null, firstInvalidSeq: null });
      expect(await verifyIn(tx, anchor)).toEqual({ reason: "truncated", firstInvalidSeq: anchor.seq });
    });
  });

  it("rejects TRUNCATE of the chain and of the activity log, cascading or not", async () => {
    for (const statement of ["truncate audit_chain", "truncate activity_log cascade", "truncate activity_log, audit_chain"]) {
      await expect(db.begin((tx) => tx.unsafe(statement))).rejects.toThrow(/append-only/);
    }
    const [{ n }] = await db`select count(*)::int n from audit_chain`;
    expect(n).toBeGreaterThan(0);
  });

  it("keeps activity rows and seals append-only", async () => {
    const id = await logRow("protected");
    await sealAll();
    await expect(db`delete from activity_log where id=${id}`).rejects.toThrow(/append-only/);
    await expect(db`update audit_chain set sealed_at=now() where log_id=${id}`).rejects.toThrow(/append-only/);
  });

  it("seals a row whose transaction committed after a higher id was sealed, and counts it as late", async () => {
    const late = postgres(url, { prepare: false, max: 1 });
    try {
      const conn = await late.reserve();
      await conn`begin`;
      const lateId = await logRow("late", conn as never);
      const earlyId = await logRow("committed first");
      expect(earlyId).toBeGreaterThan(lateId);
      expect((await sealAuditChain({ maxBatches: 5, traceId: trace })).status).toBe("sealed");
      await conn`commit`;
      conn.release();

      const fast = await verified();
      expect(fast.status).toBe("verified");
      expect(fast.unsealed).toBe(1);
      expect(await sealAll()).toMatchObject({ sealed: 1, late: 1 });
      expect(await verified()).toMatchObject({ status: "verified", unsealed: 0 });
    } finally {
      await late.end();
    }
  });

  it("a sealer that finds the chain locked returns busy instead of waiting", async () => {
    await logRow("while locked");
    const holder = postgres(url, { prepare: false, max: 1 });
    try {
      const conn = await holder.reserve();
      await conn`begin`;
      await conn`select pg_advisory_xact_lock(hashtextextended('cg-audit-chain', 0))`;
      const started = Date.now();
      expect(await sealAuditChain({ traceId: trace })).toEqual({ status: "busy" });
      expect(Date.now() - started).toBeLessThan(500);
      expect(await sealAuditChain({ full: true, traceId: trace })).toEqual({ status: "busy" });
      await conn`commit`;
      conn.release();
    } finally {
      await holder.end();
    }
    expect(await sealAll()).toMatchObject({ sealed: 1 });
  });

  it("concurrent sealers never duplicate or skip a sequence number", async () => {
    for (let i = 0; i < 40; i++) await logRow(`burst ${i}`);
    await Promise.all([
      sealAuditChain({ full: true, batch: 25, maxBatches: 5, traceId: trace }),
      sealAuditChain({ batch: 25, maxBatches: 5, traceId: trace }),
      sealAuditChain({ full: true, batch: 10, maxBatches: 10, traceId: trace }),
    ]);
    await sealAll();
    const [{ gaps }] = await db`select count(*)::int gaps from (select seq, lag(seq) over (order by seq) prev from audit_chain) s where prev is not null and seq <> prev + 1`;
    expect(gaps).toBe(0);
    expect(await verified()).toMatchObject({ status: "verified", unsealed: 0 });
  });

  it("reports a bounded check as partial, and a second verifier as busy", async () => {
    const v = await verified({ limit: 1 });
    expect(v).toMatchObject({ status: "partial", checked: 1, lastSeq: 1, reason: null });
    expect(v.maxSeq).toBeGreaterThan(1);

    const holder = postgres(url, { prepare: false, max: 1 });
    try {
      const conn = await holder.reserve();
      await conn`begin`;
      await conn`select pg_advisory_xact_lock(hashtextextended('cg-audit-verify', 0))`;
      expect(await verifyAuditChain({ traceId: trace })).toEqual({ status: "busy" });
      await conn`commit`;
      conn.release();
    } finally {
      await holder.end();
    }
  });

  it("encodes SQL NULL and JSON null differently", async () => {
    const ids = await db.begin(async (tx) => {
      const [a] = await tx`insert into activity_log (client_id,action,entity_type,old_value,trace_id) values (${clientId},'note_added','note',null,${trace}) returning id`;
      const [b] = await tx`insert into activity_log (client_id,action,entity_type,old_value,trace_id) values (${clientId},'note_added','note','null'::jsonb,${trace}) returning id`;
      return [Number(a.id), Number(b.id)];
    });
    const [c] = await db`
      select (select convert_from(public.cg_activity_canonical(l), 'UTF8')::jsonb -> 'old_value' from activity_log l where l.id=${ids[0]}) a,
             (select convert_from(public.cg_activity_canonical(l), 'UTF8')::jsonb -> 'old_value' from activity_log l where l.id=${ids[1]}) b`;
    expect(c.a).toBeNull();
    expect(c.b).toEqual([null]);
  });

  it("a Data API insert cannot claim another author or a past time", async () => {
    const authId = randomUUID();
    await db`insert into auth.users (id, email) values (${authId}, ${`audit-${tag}@test.invalid`})`;
    const [staff] = await db`insert into staff (display_name,email,role,auth_user_id) values (${`TEST Audit ${tag}`},${`audit-${tag}@test.invalid`},'admin',${authId}) returning id,display_name,email,role`;
    const session: StaffSession = { authUserId: authId, staff: staff as StaffSession["staff"] };
    const id = await withStaff(session, async (tx) => {
      const [row] = await tx`
        insert into activity_log (client_id,action,staff_id,entity_type,new_value,trace_id,created_at)
        values (${clientId},'note_added',null,'note',${tx.json({ forged: true, tag } as never)},${trace},'2001-01-01T00:00:00Z')
        returning id`;
      return Number(row.id);
    });
    const [row] = await db`select staff_id, created_at > now() - interval '1 minute' recent from activity_log where id=${id}`;
    expect(row).toEqual({ staff_id: staff.id, recent: true });
  });

  it("is closed to signed-in staff and portal sessions, and service_role can only read it", async () => {
    for (const role of ["authenticated", "anon"]) {
      await expect(db.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        await tx`select * from public.cg_audit_seal(1, false)`;
      })).rejects.toThrow(/permission denied/);
      await expect(db.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        await tx`select count(*) from audit_chain`;
      })).rejects.toThrow(/permission denied/);
    }
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const [{ allowed }] = await db`select has_table_privilege(${role}, 'public.audit_chain', ${privilege}) allowed`;
        expect(allowed, `${role} ${privilege}`).toBe(role === "service_role" && privilege === "SELECT");
      }
    }
    const [{ forced }] = await db`select relforcerowsecurity forced from pg_class where oid = 'public.audit_chain'::regclass`;
    expect(forced).toBe(false);
  });
});
