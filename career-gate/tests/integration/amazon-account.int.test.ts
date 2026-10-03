import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import type { StaffSession } from "@/lib/auth";
import {
  addAmazonEmail,
  confirmAmazonAssignment,
  getAmazonAccountForClient,
  markAmazonAccountReady,
  releaseAmazonEmail,
  reserveAmazonEmail,
  revealAmazonAccount,
  revealAmazonEmail,
  updateAmazonAccount,
  updateAmazonEmail,
} from "@/lib/amazon/service";
import { insertClient } from "@/lib/service";
import { ProfileSchema } from "@/lib/schemas";

const db = postgres(process.env.DATABASE_URL!, { prepare: false, max: 2 });
const trace = "amazon-account-integration";
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
  await db`insert into auth.users (id,email) values (${authId},'amazon-admin@test.invalid')`;
  const [staff] = await db`insert into staff (display_name,email,role,auth_user_id) values ('TEST Amazon Admin','amazon-admin@test.invalid','admin',${authId}) returning id,display_name,email,role`;
  admin = { authUserId: authId, staff: staff as StaffSession["staff"] };
  clientA = await makeClient("TEST Amazon A");
  clientB = await makeClient("TEST Amazon B");
});

afterAll(async () => { await db.end(); });

describe("Amazon Account Workspace domain", () => {
  it("encrypts vault secrets, reserves atomically, snapshots independently, and preserves contact-email isolation", async () => {
    const source = await addAmazonEmail(admin, { email: "  Vault.One@Gmail.com ", password: "VaultPassword-123", pin: "654321" }, trace);
    const [stored] = await db`select email,email_normalized,password_ciphertext,pin_ciphertext,status from amazon_emails where id=${source.id}`;
    expect(stored.email_normalized).toBe("vault.one@gmail.com");
    expect(stored.password_ciphertext).not.toContain("VaultPassword-123");
    expect(stored.pin_ciphertext).not.toContain("654321");
    expect(await revealAmazonEmail(admin, source.id, "password", "reveal", trace)).toBe("VaultPassword-123");

    await reserveAmazonEmail(admin, source.id, clientA.id, trace);
    const account = await confirmAmazonAssignment(admin, source.id, clientA.id, trace);
    const [sourceAfter] = await db`select status from amazon_emails where id=${source.id}`;
    const [client] = await db`select email from clients where id=${clientA.id}`;
    expect(sourceAfter.status).toBe("USED");
    expect(account.status).toBe("PENDING");
    expect(client.email).not.toBe("vault.one@gmail.com");
    expect(await revealAmazonAccount(admin, account.id, "password", "reveal", trace)).toBe("VaultPassword-123");

    await updateAmazonEmail(admin, { id: source.id, password: "VaultChanged-456", pin: "111111" }, trace);
    expect(await revealAmazonEmail(admin, source.id, "password", "reveal", trace)).toBe("VaultChanged-456");
    expect(await revealAmazonAccount(admin, account.id, "password", "reveal", trace)).toBe("VaultPassword-123");

    await updateAmazonAccount(admin, { account_id: account.id, password: "ClientSnapshot-789", pin: "222222" }, trace);
    expect(await revealAmazonAccount(admin, account.id, "password", "reveal", trace)).toBe("ClientSnapshot-789");
    expect(await revealAmazonEmail(admin, source.id, "password", "reveal", trace)).toBe("VaultChanged-456");

    const ready = await markAmazonAccountReady(admin, account.id, trace);
    expect(ready.status).toBe("READY");
    const card = await getAmazonAccountForClient(admin, clientA.id);
    expect(card?.id).toBe(account.id);
  });

  it("blocks duplicate active accounts and concurrent use of one source email", async () => {
    const second = await addAmazonEmail(admin, { email: "second@test.invalid", password: "Password-Second-1", pin: "123456" }, trace);
    await expect(reserveAmazonEmail(admin, second.id, clientA.id, trace)).rejects.toMatchObject({ code: "client_has_account" });

    const third = await addAmazonEmail(admin, { email: "third@test.invalid", password: "Password-Third-1", pin: "123456" }, trace);
    await reserveAmazonEmail(admin, third.id, clientB.id, trace);
    const results = await Promise.allSettled([
      confirmAmazonAssignment(admin, third.id, clientB.id, `${trace}-1`),
      confirmAmazonAssignment(admin, third.id, clientB.id, `${trace}-2`),
    ]);
    expect(results.filter((result)=>result.status==="fulfilled")).toHaveLength(1);
    expect((await db`select id from amazon_accounts where assigned_to_client_id=${clientB.id} and status in ('PENDING','READY')`).length).toBe(1);
  });

  it("releases reservations idempotently and keeps direct API roles away from credential tables", async () => {
    const source = await addAmazonEmail(admin, { email: "release@test.invalid", password: "Password-Release-1", pin: "123456" }, trace);
    await reserveAmazonEmail(admin, source.id, randomUUID(), trace).catch(()=>undefined);
    expect(await releaseAmazonEmail(admin, source.id, trace)).toMatchObject({ status: "AVAILABLE" });
    expect(await releaseAmazonEmail(admin, source.id, trace)).toMatchObject({ status: "AVAILABLE" });
    await expect(db.begin(async (tx)=>{await tx.unsafe("set local role authenticated");return tx`select * from amazon_emails limit 1`;})).rejects.toMatchObject({ code:"42501" });
    await expect(db.begin(async (tx)=>{await tx.unsafe("set local role anon");return tx`select * from amazon_accounts limit 1`;})).rejects.toMatchObject({ code:"42501" });
  });
});
