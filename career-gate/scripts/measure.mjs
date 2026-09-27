// Measures request latency against a running Career Gate (local e2e harness).
// Prints p50/p95/n per operation with the commit SHA. No numbers are assumed.
// Env: BASE_URL, SUPABASE_JWT_SECRET, NEXT_PUBLIC_SUPABASE_URL, DATABASE_URL, E2E_CATALOG, SAMPLES
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import postgres from "postgres";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3456";
const N = Number(process.env.SAMPLES ?? 30);
const sha = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })();
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const fixture = (process.env.E2E_CATALOG ?? "fixture") === "fixture";

const token = await new SignJWT({ role: "authenticated" })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuer(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`).setAudience("authenticated")
  .setSubject("00000000-0000-4000-8000-00000000a001").setExpirationTime("1h")
  .sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET));
const staff = { cookie: `cg_at=${token}` };

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
async function time(fn) { const t = performance.now(); const r = await fn(); if (!r.ok && r.status !== 200 && r.status !== 201) throw new Error(`HTTP ${r.status}`); await r.arrayBuffer(); return performance.now() - t; }
async function measure(name, fn, n = N) {
  const xs = [];
  for (let i = 0; i < n; i++) xs.push(await time(fn));
  return { operation: name, n: xs.length, p50_ms: Math.round(pct(xs, 50)), p95_ms: Math.round(pct(xs, 95)) };
}

const body = (i) => ({
  state: "MI",
  profile: { full_name: `TEST Perf ${i}`, phone: "3135550100", employment_history: [] },
  primary: fixture ? [{ site_code: "TST1", job_id: "J-A", shift_code: "S1" }] : [], backup: [], communication_consent: false,
  authorization: { version: "2026-09-26.1", accepted: true, accuracy_acknowledged: true, printed_name: `TEST Perf ${i}`, signature: `TEST Perf ${i}` },
});
const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000004000000040802000000269309290000000970485973000003e8000003e801b57b526b0000000f49444154089963f88f041888e30000db902fd1ecba04730000000049454e44ae426082", "hex");

let i = 0;
let lastClient = null;
const results = [];
results.push(await measure("public form navigation (GET /apply)", () => fetch(`${BASE}/apply`)));
results.push(await measure("intake submit (POST /api/intake)", async () => {
  const r = await fetch(`${BASE}/api/intake`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": randomUUID(), "x-forwarded-for": ip() }, body: JSON.stringify(body(i++)) });
  return r;
}));
const db = postgres(process.env.DATABASE_URL, { max: 1 });
[{ id: lastClient }] = await db`select id from clients where full_name like 'TEST Perf %' order by created_at desc limit 1`;
results.push(await measure("dashboard (GET /staff)", () => fetch(`${BASE}/staff`, { headers: staff })));
results.push(await measure("client search (GET /api/staff/search)", () => fetch(`${BASE}/api/staff/search?q=TEST`, { headers: staff })));
results.push(await measure("document upload (POST /api/staff/documents)", () => {
  const f = new FormData();
  f.set("client_id", lastClient); f.set("doc_type", "other"); f.set("file", new Blob([png], { type: "image/png" }), "p.png");
  return fetch(`${BASE}/api/staff/documents`, { method: "POST", headers: staff, body: f });
}, 10));
results.push(await measure("intake agent (run_intake_agent)", () => fetch(`${BASE}/api/staff/action`, { method: "POST", headers: { ...staff, "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ action: "run_intake_agent", client_id: lastClient }) })));
results.push(await measure("status lookup (POST /api/status/lookup; 700 ms floor by design)", () => fetch(`${BASE}/api/status/lookup`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ identifier: "CG-1999-000000" }) }), 10));
await new Promise((r) => setTimeout(r, 2000));
const q = await db`select extract(epoch from (started_at - created_at)) * 1000 as ms from jobs where started_at is not null and type = 'document_extraction'`;
const qs = q.map((r) => Number(r.ms));
results.push({ operation: "queue wait (document_extraction created → started)", n: qs.length, p50_ms: qs.length ? Math.round(pct(qs, 50)) : null, p95_ms: qs.length ? Math.round(pct(qs, 95)) : null });
const ex = await db`select duration_ms, status from document_extractions`;
results.push({ operation: "document extraction", n: 0, p50_ms: null, p95_ms: null, note: `not measurable: ${ex[0]?.status ?? "no runs"} (vision provider NOT_CONFIGURED)` });
await db.end();
console.log(JSON.stringify({ commit: sha, base_url: BASE, environment: "local e2e harness (PostgreSQL 16, next start, Storage stand-in)", results }, null, 2));
