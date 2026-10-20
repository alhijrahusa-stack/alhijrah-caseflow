import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { sealAuditChain, verifyAuditChain } from "@/lib/audit-chain";
import { ProfileSchema } from "@/lib/schemas";
import { insertClient } from "@/lib/service";

/**
 * The tamper-evident activity chain (migration 046), against the real schema.
 * Tampering is simulated the only way it can happen: a superuser session that
 * disables the append-only trigger. Every tamper is reverted before the test
 * ends so the shared database is left with a valid chain. Synthetic data only.
 */

const url = process.env.DATABASE_URL!;
const db = postgres(url, { prepare: false, max: 1 });
const trace = "audit-chain-int";
const tag = randomUUID().slice(0, 8);
let clientId = "";
// A range of its own: the integration suites share one database.
let phoneSequence = 9100;
const nextPhone = () => `313557${String(++phoneSequence).padStart(4, "0")}`;

async function logRow(note: string) {
  const [row] = await db`
    insert into activity_log (client_id,action,entity_type,entity_id,new_value,trace_id)
    values (${clientId},'note_added','note',${randomUUID()},${db.json({ note, tag } as never)},${trace})
    returning id`;
  return Number(row.id);
}

async function sealAll() {
  const result = await sealAuditChain({ full: true, maxBatches: 200, traceId: trace });
  expect(result.status).toBe("sealed");
}

async function verified() {
  const result = await verifyAuditChain(trace);
  expect(result.status).not.toBe("schema_pending");
  return result as Exclude<typeof result, { status: "schema_pending" }>;
}

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
  it("seals every activity row and verifies the whole chain", async () => {
    await logRow("one");
    await logRow("two");
    await sealAll();
    const v = await verified();
    expect(v).toMatchObject({ status: "verified", firstInvalidSeq: null, reason: null, unsealed: 0 });
    const [{ n }] = await db`select count(*)::int n from activity_log`;
    expect(v.checked).toBe(n);
  });

  it("is deterministic: verifying twice gives the same result", async () => {
    expect(await verified()).toEqual(await verified());
  });

  it("detects an altered sealed row, and verifies again once it is restored", async () => {
    const id = await logRow("original");
    await sealAll();
    const [{ seq }] = await db`select seq from audit_chain where log_id=${id}`;
    const [{ new_value: original }] = await db`select new_value from activity_log where id=${id}`;

    await db.begin(async (tx) => {
      await tx`alter table activity_log disable trigger activity_log_append_only`;
      await tx`update activity_log set new_value=${tx.json({ note: "tampered", tag } as never)} where id=${id}`;
      await tx`alter table activity_log enable trigger activity_log_append_only`;
    });
    const broken = await verified();
    expect(broken).toMatchObject({ status: "invalid", firstInvalidSeq: Number(seq), reason: "content_mismatch" });

    await db.begin(async (tx) => {
      await tx`alter table activity_log disable trigger activity_log_append_only`;
      await tx`update activity_log set new_value=${tx.json(original as never)} where id=${id}`;
      await tx`alter table activity_log enable trigger activity_log_append_only`;
    });
    expect((await verified()).status).toBe("verified");
  });

  it("detects a removed seal as a sequence gap", async () => {
    const id = await logRow("gap");
    await logRow("after gap");
    await sealAll();
    const [removed] = await db`select * from audit_chain where log_id=${id}`;

    await db.begin(async (tx) => {
      await tx`alter table audit_chain disable trigger audit_chain_append_only`;
      await tx`delete from audit_chain where seq=${removed.seq}`;
      await tx`alter table audit_chain enable trigger audit_chain_append_only`;
    });
    expect(await verified()).toMatchObject({ status: "invalid", firstInvalidSeq: Number(removed.seq), reason: "sequence_gap" });

    await db`insert into audit_chain (seq,log_id,prev_hash,row_hash,sealed_at)
             values (${removed.seq},${removed.log_id},${removed.prev_hash},${removed.row_hash},${removed.sealed_at})`;
    expect((await verified()).status).toBe("verified");
  });

  it("keeps activity rows and seals append-only", async () => {
    const id = await logRow("protected");
    await sealAll();
    await expect(db`delete from activity_log where id=${id}`).rejects.toThrow(/append-only/);
    await expect(db`update audit_chain set sealed_at=now() where log_id=${id}`).rejects.toThrow(/append-only/);
  });

  it("seals a row whose transaction committed after a higher id was sealed", async () => {
    const late = postgres(url, { prepare: false, max: 1 });
    try {
      const reserved = late.reserve();
      const conn = await reserved;
      await conn`begin`;
      const [{ id: lateId }] = await conn`
        insert into activity_log (client_id,action,entity_type,entity_id,new_value,trace_id)
        values (${clientId},'note_added','note',${randomUUID()},${conn.json({ note: "late", tag } as never)},${trace})
        returning id`;
      const earlyId = await logRow("committed first");
      expect(earlyId).toBeGreaterThan(Number(lateId));
      expect((await sealAuditChain({ maxBatches: 5, traceId: trace })).status).toBe("sealed");
      await conn`commit`;
      conn.release();

      const fast = await verified();
      expect(fast.status).toBe("verified");
      expect(fast.unsealed).toBe(1);
      await sealAll();
      expect(await verified()).toMatchObject({ status: "verified", unsealed: 0 });
    } finally {
      await late.end();
    }
  });

  it("concurrent sealers never duplicate or skip a sequence number", async () => {
    for (let i = 0; i < 40; i++) await logRow(`burst ${i}`);
    const a = postgres(url, { prepare: false, max: 1 });
    const b = postgres(url, { prepare: false, max: 1 });
    try {
      const [ra, rb] = await Promise.all([
        a`select public.cg_audit_seal(25, true) n`,
        b`select public.cg_audit_seal(25, true) n`,
      ]);
      expect(Number(ra[0].n) + Number(rb[0].n)).toBe(40);
    } finally {
      await Promise.all([a.end(), b.end()]);
    }
    const [{ gaps }] = await db`select count(*)::int gaps from (select seq, lag(seq) over (order by seq) prev from audit_chain) s where prev is not null and seq <> prev + 1`;
    expect(gaps).toBe(0);
    expect(await verified()).toMatchObject({ status: "verified", unsealed: 0 });
  });

  it("is closed to signed-in staff and portal sessions", async () => {
    for (const role of ["authenticated", "anon"]) {
      await expect(db.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        await tx`select public.cg_audit_seal(1, false)`;
      })).rejects.toThrow(/permission denied/);
      await expect(db.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`);
        await tx`select count(*) from audit_chain`;
      })).rejects.toThrow(/permission denied/);
    }
  });
});
