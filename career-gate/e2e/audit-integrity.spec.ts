import { expect, test } from "@playwright/test";
import { accessToken, uniqueIp } from "./helpers";

/**
 * The activity audit chain through the application: the nightly maintenance
 * run seals and verifies it, an admin can re-verify on demand, and nobody else
 * can reach the verification.
 */

test("maintenance seals the activity chain and an admin verifies it", async ({ request }) => {
  const cron = await request.get("/api/cron/maintenance", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect(cron.status()).toBe(200);
  const run = await cron.json();
  expect(run.audit_chain.seal.status).toBe("sealed");
  expect(run.audit_chain.verify).toMatchObject({ status: "verified", firstInvalidSeq: null, reason: null });

  const res = await request.get("/api/staff/audit-integrity", {
    headers: { cookie: `cg_at=${await accessToken("admin")}`, "x-forwarded-for": uniqueIp() },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.audit_chain).toMatchObject({ status: "verified", firstInvalidSeq: null, reason: null });
  expect(body.audit_chain.checked).toBeGreaterThan(0);
});

test("audit verification is admin-only", async ({ request }) => {
  for (const role of ["manager", "staff"] as const) {
    const res = await request.get("/api/staff/audit-integrity", {
      headers: { cookie: `cg_at=${await accessToken(role)}`, "x-forwarded-for": uniqueIp() },
    });
    expect(res.status(), role).toBe(403);
  }
  const anonymous = await request.get("/api/staff/audit-integrity", { headers: { cookie: "" } });
  expect(anonymous.status()).toBe(401);
});

test("an incoming W3C traceparent becomes the response trace id", async ({ request }) => {
  const res = await request.get("/api/staff/audit-integrity", {
    headers: { cookie: `cg_at=${await accessToken("admin")}`, traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" },
  });
  expect((await res.json()).trace_id).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
});
