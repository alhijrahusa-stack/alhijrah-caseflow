// Measures Career Gate request latency and transferred payload.
// Read-only production/preview mode: PERF_READ_ONLY=1 PERF_COOKIE='cg_at=...' BASE_URL='https://...'
// Local full harness mode keeps the existing mutation/upload/queue measurements.
// Output includes n/p50/p95/p99, failures, status codes, and response bytes.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import postgres from "postgres";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3456";
const N = Number(process.env.SAMPLES ?? 30);
const READ_ONLY = process.env.PERF_READ_ONLY === "1";
const RUN_LABEL = process.env.PERF_RUN_LABEL ?? "unspecified";
const TEST_CONDITIONS = process.env.PERF_TEST_CONDITIONS ?? "unspecified";
const sha = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
})();

const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const fixture = (process.env.E2E_CATALOG ?? "fixture") === "fixture";

async function staffHeaders() {
  const supplied = process.env.PERF_COOKIE?.trim();
  if (supplied) return { cookie: supplied };

  const secret = process.env.SUPABASE_JWT_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!secret || !supabaseUrl) {
    throw new Error("PERF_COOKIE or SUPABASE_JWT_SECRET + NEXT_PUBLIC_SUPABASE_URL is required");
  }

  const token = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(`${supabaseUrl}/auth/v1`)
    .setAudience("authenticated")
    .setSubject("00000000-0000-4000-8000-00000000a001")
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(secret));

  return { cookie: `cg_at=${token}` };
}

const staff = await staffHeaders();

function pct(xs, p) {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function sample(fn) {
  const started = performance.now();
  const response = await fn();
  const payload = await response.arrayBuffer();
  return {
    ms: performance.now() - started,
    bytes: payload.byteLength,
    status: response.status,
    ok: response.ok,
  };
}

async function measure(name, fn, n = N) {
  const timings = [];
  const bytes = [];
  const statuses = new Map();
  let failures = 0;

  for (let i = 0; i < n; i += 1) {
    const result = await sample(fn);
    timings.push(result.ms);
    bytes.push(result.bytes);
    statuses.set(result.status, (statuses.get(result.status) ?? 0) + 1);
    if (!result.ok) failures += 1;
  }

  return {
    operation: name,
    n,
    failures,
    status_counts: Object.fromEntries(statuses),
    p50_ms: Math.round(pct(timings, 50)),
    p95_ms: Math.round(pct(timings, 95)),
    p99_ms: Math.round(pct(timings, 99)),
    payload_p50_bytes: Math.round(pct(bytes, 50)),
    payload_p95_bytes: Math.round(pct(bytes, 95)),
  };
}

const results = [];

const dashboardRoutes = [
  ["dashboard today", "/staff?tab=today"],
  ["dashboard week", "/staff?tab=week"],
  ["dashboard reports 7d", "/staff?tab=reports&period=7"],
  ["dashboard reports 30d", "/staff?tab=reports&period=30"],
  ["dashboard reports 90d", "/staff?tab=reports&period=90"],
  ["dashboard settings", "/staff?tab=settings"],
];

for (const [name, path] of dashboardRoutes) {
  results.push(await measure(name, () => fetch(`${BASE}${path}`, { headers: staff, redirect: "manual" })));
}

if (!READ_ONLY) {
  const body = (i) => ({
    state: "MI",
    profile: { full_name: `TEST Perf ${i}`, phone: "3135550100", employment_history: [] },
    primary: fixture ? [{ site_code: "TST1", job_id: "J-A", shift_code: "S1" }] : [],
    backup: [],
    communication_consent: false,
    authorization: {
      version: "2026-09-26.1",
      accepted: true,
      accuracy_acknowledged: true,
      printed_name: `TEST Perf ${i}`,
      signature: `TEST Perf ${i}`,
    },
  });

  const png = Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000004000000040802000000269309290000000970485973000003e8000003e801b57b526b0000000f49444154089963f88f041888e30000db902fd1ecba04730000000049454e44ae426082",
    "hex",
  );

  let i = 0;
  results.push(await measure("public form navigation (GET /apply)", () => fetch(`${BASE}/apply`)));
  results.push(await measure("intake submit (POST /api/intake)", () =>
    fetch(`${BASE}/api/intake`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
        "x-forwarded-for": ip(),
      },
      body: JSON.stringify(body(i++)),
    })));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required when PERF_READ_ONLY is not 1");
  const db = postgres(databaseUrl, { max: 1 });

  let lastClient = null;
  [{ id: lastClient }] = await db`
    select id from clients where full_name like 'TEST Perf %' order by created_at desc limit 1
  `;

  results.push(await measure("client search (GET /api/staff/search)", () =>
    fetch(`${BASE}/api/staff/search?q=TEST`, { headers: staff })));

  results.push(await measure("document upload (POST /api/staff/documents)", () => {
    const form = new FormData();
    form.set("client_id", lastClient);
    form.set("doc_type", "other");
    form.set("file", new Blob([png], { type: "image/png" }), "p.png");
    return fetch(`${BASE}/api/staff/documents`, { method: "POST", headers: staff, body: form });
  }, 10));

  results.push(await measure("intake agent (run_intake_agent)", () =>
    fetch(`${BASE}/api/staff/action`, {
      method: "POST",
      headers: { ...staff, "content-type": "application/json", "x-forwarded-for": ip() },
      body: JSON.stringify({ action: "run_intake_agent", client_id: lastClient }),
    })));

  results.push(await measure("status lookup (POST /api/status/lookup; 700 ms floor by design)", () =>
    fetch(`${BASE}/api/status/lookup`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip() },
      body: JSON.stringify({ identifier: "CG-1999-000000" }),
    }), 10));

  await new Promise((resolve) => setTimeout(resolve, 2000));

  const queueRows = await db`
    select extract(epoch from (started_at - created_at)) * 1000 as ms
    from jobs
    where started_at is not null and type = 'document_extraction'
  `;
  const queueWait = queueRows.map((row) => Number(row.ms));
  results.push({
    operation: "queue wait (document_extraction created → started)",
    n: queueWait.length,
    failures: 0,
    p50_ms: queueWait.length ? Math.round(pct(queueWait, 50)) : null,
    p95_ms: queueWait.length ? Math.round(pct(queueWait, 95)) : null,
    p99_ms: queueWait.length ? Math.round(pct(queueWait, 99)) : null,
  });

  const extractions = await db`select duration_ms, status from document_extractions`;
  const durations = extractions
    .map((row) => Number(row.duration_ms))
    .filter((value) => Number.isFinite(value) && value >= 0);
  results.push({
    operation: "document extraction",
    n: durations.length,
    failures: extractions.filter((row) => row.status === "failed").length,
    p50_ms: durations.length ? Math.round(pct(durations, 50)) : null,
    p95_ms: durations.length ? Math.round(pct(durations, 95)) : null,
    p99_ms: durations.length ? Math.round(pct(durations, 99)) : null,
    note: durations.length ? undefined : `not measurable: ${extractions[0]?.status ?? "no runs"}`,
  });

  await db.end();
}

console.log(JSON.stringify({
  commit: sha,
  base_url: BASE,
  run_label: RUN_LABEL,
  test_conditions: TEST_CONDITIONS,
  sample_size: N,
  read_only: READ_ONLY,
  authentication_context: process.env.PERF_COOKIE ? "supplied session cookie" : "generated local staff JWT",
  results,
}, null, 2));
