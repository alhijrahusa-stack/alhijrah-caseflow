import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { withStaff, type StaffSession } from "@/lib/auth";
import { archiveClient } from "@/lib/client-archive";
import {
  addGateJobEmail,
  confirmGateJobAssignment,
  getGateJobAccountForClient,
  markGateJobAccountReady,
  releaseGateJobEmail,
  reserveGateJobEmail,
  revealGateJobAccount,
  revealGateJobEmail,
  updateGateJobAccount,
  updateGateJobEmail,
} from "@/lib/gate-job-account/service";
import { insertClient } from "@/lib/service";
import { ProfileSchema } from "@/lib/schemas";

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2 });
const trace = "gate-job-account-integration";
let admin: StaffSession;
let clientA: { id: string; ref: string };
let clientB: { id: string; ref: string };
let seq = 7000;

async function makeClient(name: string) {
  seq += 1;
  return db.begin((tx) => insertClient(tx, {
    source: "staff_manual",
    profile: ProfileSchema.parse({ full_name: name, phone: `313555${seq}`, email: `${name.replace(/\W/g,"").toLowerCase()}@test.invalid`, employment_history: [] }),
    primary: [], backup: [], status: "new_intake", nextStep: null, assignedStaff: null, createdBy: admin.staff.id, communicationConsent: true,
  }, { staffId: admin.staff.id, traceId: trace }));
}

beforeAll(async () => {
  const authId = randomUUID();
  await db`insert into auth.users (id,email) values (${authId},'gate-job-admin@test.invalid')`;
  const [staff] = await db`insert into staff (display_name,email,role,auth_user_id) values ('TEST Gate Job Admin','gate-job-admin@test.invalid','admin',${authId}) returning id,display_name,email,role`;
  admin = { authUserId: authId, staff: staff as StaffSession["staff"] };
  clientA = await makeClient("TEST Gate Job A");
  clientB = await makeClient("TEST Gate Job B");
});

afterAll(async () => { await db.end(); });

describe("Gate Job Account Workspace domain", () => {
  it("encrypts vault secrets, reserves atomically, snapshots independently, and preserves contact-email isolation", async () => {
    const source = await addGateJobEmail(admin, { email: "  Vault.One@Gmail.com ", password: "VaultPassword-123", pin: "654321" }, trace);
    const [stored] = await db`select email,email_normalized,password_ciphertext,pin_ciphertext,status from gate_job_emails where id=${source.id}`;
    expect(stored.email_normalized).toBe("vault.one@gmail.com");
    expect(stored.password_ciphertext).not.toContain("VaultPassword-123");
    expect(stored.pin_ciphertext).not.toContain("654321");
    expect(await revealGateJobEmail(admin, source.id, "password", "reveal", trace)).toBe("VaultPassword-123");

    await reserveGateJobEmail(admin, source.id, clientA.id, trace);
    const account = await confirmGateJobAssignment(admin, source.id, clientA.id, trace);
    const [sourceAfter] = await db`select status from gate_job_emails where id=${source.id}`;
    const [client] = await db`select email from clients where id=${clientA.id}`;
    expect(sourceAfter.status).toBe("USED");
    expect(account.status).toBe("PENDING");
    expect(client.email).not.toBe("vault.one@gmail.com");
    expect(await revealGateJobAccount(admin, account.id, "password", "reveal", trace)).toBe("VaultPassword-123");

    await updateGateJobEmail(admin, { id: source.id, password: "VaultChanged-456", pin: "111111" }, trace);
    expect(await revealGateJobEmail(admin, source.id, "password", "reveal", trace)).toBe("VaultChanged-456");
    expect(await revealGateJobAccount(admin, account.id, "password", "reveal", trace)).toBe("VaultPassword-123");

    await updateGateJobAccount(admin, { account_id: account.id, password: "ClientSnapshot-789", pin: "222222" }, trace);
    expect(await revealGateJobAccount(admin, account.id, "password", "reveal", trace)).toBe("ClientSnapshot-789");
    expect(await revealGateJobEmail(admin, source.id, "password", "reveal", trace)).toBe("VaultChanged-456");

    const ready = await markGateJobAccountReady(admin, account.id, trace);
    expect(ready.status).toBe("READY");
    const card = await getGateJobAccountForClient(admin, clientA.id);
    expect(card?.id).toBe(account.id);
    const [access] = await withStaff(admin,tx=>tx`
      select career_gate_private.has_ready_gate_job_account(${clientA.id}) as ready,
             career_gate_private.has_ready_gate_job_account(${clientB.id}) as missing`);
    expect(access).toEqual({ ready:true, missing:false });
    await expect(db.begin(async tx=>{
      await tx.unsafe("set local role anon");
      return tx`select career_gate_private.has_ready_gate_job_account(${clientA.id})`;
    })).rejects.toMatchObject({code:"42501"});
    await expect(withStaff(admin,tx=>tx`select * from gate_job_accounts limit 1`)).rejects.toMatchObject({code:"42501"});
  });

  it("blocks duplicate active accounts and concurrent use of one source email", async () => {
    const second = await addGateJobEmail(admin, { email: "second@test.invalid", password: "Password-Second-1", pin: "123456" }, trace);
    await expect(reserveGateJobEmail(admin, second.id, clientA.id, trace)).rejects.toMatchObject({ code: "client_has_account" });

    const third = await addGateJobEmail(admin, { email: "third@test.invalid", password: "Password-Third-1", pin: "123456" }, trace);
    await reserveGateJobEmail(admin, third.id, clientB.id, trace);
    const results = await Promise.allSettled([
      confirmGateJobAssignment(admin, third.id, clientB.id, `${trace}-1`),
      confirmGateJobAssignment(admin, third.id, clientB.id, `${trace}-2`),
    ]);
    expect(results.filter((result)=>result.status==="fulfilled")).toHaveLength(1);
    expect((await db`select id from gate_job_accounts where assigned_to_client_id=${clientB.id} and status in ('PENDING','READY')`).length).toBe(1);
  });

  it("releases reservations idempotently and keeps direct API roles away from credential tables", async () => {
    const source = await addGateJobEmail(admin, { email: "release@test.invalid", password: "Password-Release-1", pin: "123456" }, trace);
    await reserveGateJobEmail(admin, source.id, randomUUID(), trace).catch(()=>undefined);
    expect(await releaseGateJobEmail(admin, source.id, trace)).toMatchObject({ status: "AVAILABLE" });
    expect(await releaseGateJobEmail(admin, source.id, trace)).toMatchObject({ status: "AVAILABLE" });
    await expect(db.begin(async (tx)=>{await tx.unsafe("set local role authenticated");return tx`select * from gate_job_emails limit 1`;})).rejects.toMatchObject({ code:"42501" });
    await expect(db.begin(async (tx)=>{await tx.unsafe("set local role anon");return tx`select * from gate_job_accounts limit 1`;})).rejects.toMatchObject({ code:"42501" });
  });

  it("returns only the public card fields and keeps assignment and deletion access checks", async () => {
    const ownerAuth = randomUUID();
    const outsiderAuth = randomUUID();
    const members: StaffSession[] = [];
    for (const authId of [ownerAuth, outsiderAuth]) {
      const email = `gate-read-${authId}@test.invalid`;
      await db`insert into auth.users(id,email) values(${authId},${email})`;
      const [staff] = await db`insert into staff(display_name,email,role,auth_user_id)
        values(${`TEST Gate Read Staff ${authId}`},${email},'staff',${authId}) returning id,display_name,email,role`;
      members.push({authUserId:authId,staff:staff as StaffSession["staff"]});
    }
    const [owner, outsider] = members;
    const client = await makeClient("TEST Gate Read Scope");
    await db`update clients set assigned_staff=${owner.staff.id} where id=${client.id}`;
    const source = await addGateJobEmail(admin, {email:`gate-card-${randomUUID()}@test.invalid`,password:"Private-Read-Secret-123",pin:"654321"},trace);
    await reserveGateJobEmail(admin,source.id,client.id,trace);
    const account = await confirmGateJobAssignment(admin,source.id,client.id,trace);

    const card = await getGateJobAccountForClient(owner,client.id);
    expect(Object.keys(card ?? {}).sort()).toEqual([
      "id","assigned_to_client_id","email_snapshot","status","assigned_at","ready_at","updated_at",
    ].sort());
    expect(card).toMatchObject({id:account.id,assigned_to_client_id:client.id,status:"PENDING"});
    expect(JSON.stringify(card)).not.toContain("Private-Read-Secret-123");
    await expect(getGateJobAccountForClient(outsider,client.id)).rejects.toMatchObject({code:"forbidden",status:403});
    await withStaff(admin,tx=>archiveClient(tx,admin,client.id,"Read-card access regression",trace));
    await expect(getGateJobAccountForClient(owner,client.id)).rejects.toMatchObject({code:"client_not_found",status:404});
    await expect(getGateJobAccountForClient(admin,client.id)).rejects.toMatchObject({code:"client_not_found",status:404});
  });

  it("distinguishes a live client without an account from a missing client", async () => {
    const client = await makeClient("TEST Gate Read Empty");
    expect(await getGateJobAccountForClient(admin,client.id)).toBeNull();
    await expect(getGateJobAccountForClient(admin,randomUUID())).rejects.toMatchObject({code:"client_not_found",status:404});
  });

  it("reads the client card while another transaction holds the client write lock", async context => {
    const [server] = await db`select version() as version`;
    // The local Wasm harness shares one underlying PostgreSQL session and cannot
    // establish lock contention. This regression runs against native PG in CI.
    if (String(server.version).includes("PGlite")) context.skip("Native PostgreSQL row-lock concurrency required");
    const client = await makeClient("TEST Gate Read Concurrent");
    let read: ReturnType<typeof getGateJobAccountForClient> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await db.begin(async tx => {
        await tx`select id from clients where id=${client.id} for update`;
        read = getGateJobAccountForClient(admin,client.id);
        const result = await Promise.race([
          read.then(value=>({finished:true as const,value})),
          new Promise<{finished:false}>(resolve=>{timer=setTimeout(()=>resolve({finished:false}),2000);}),
        ]);
        expect(result.finished).toBe(true);
        if(result.finished)expect(result.value).toBeNull();
      });
    } finally {
      if(timer)clearTimeout(timer);
      await read?.catch(()=>undefined);
    }
  });
});
