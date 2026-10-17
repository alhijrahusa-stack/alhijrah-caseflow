// Career Gate browser-side performance baseline.
//
// Companion to scripts/measure.mjs, which covers server route and API latency.
// This covers what that cannot see: main-thread blocking, Total Blocking Time,
// measured INP from real interactions, CLS, and React commit counts.
//
// Usage (against a running build, with a staff session available):
//   BASE_URL=http://127.0.0.1:3000 PERF_CLIENT_ID=<client uuid> \
//   SUPABASE_JWT_SECRET=... NEXT_PUBLIC_SUPABASE_URL=... \
//   RUNS=5 CPU_THROTTLE=4 OUT=baseline.json node scripts/profile-browser.mjs
//
// CPU_THROTTLE=4 models mid-tier hardware; 1 measures the host unthrottled.
// Run the same command before and after a change to compare like with like.
// Collects, per route and per viewport, from a real Chromium against a real
// production build: Long Tasks, Total Blocking Time, LCP/FCP/TTFB, CLS,
// measured INP from real interactions, client-side navigation latency, and
// React commit counts taken from the DevTools global hook.
//
// Nothing here is estimated. A metric that could not be observed is reported
// as null, never as a number.
import { chromium } from "@playwright/test";
import { SignJWT } from "jose";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3457";
const RUNS = Number(process.env.RUNS ?? 5);
const CPU_THROTTLE = Number(process.env.CPU_THROTTLE ?? 1);
const OUT = process.env.OUT ?? "/tmp/perf-baseline.json";
const LABEL = process.env.PERF_RUN_LABEL ?? "baseline";

const sha = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })();

const VIEWPORTS = [
  { name: "desktop", width: 1920, height: 1080, isMobile: false },
  { name: "tablet", width: 820, height: 1180, isMobile: false },
  { name: "mobile", width: 390, height: 844, isMobile: true },
];

async function staffCookie() {
  const token = await new SignJWT({ role: "authenticated" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`)
    .setAudience("authenticated")
    .setSubject(process.env.PERF_STAFF_SUB ?? "00000000-0000-4000-8000-00000000a001")
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET));
  const url = new URL(BASE);
  return { name: "cg_at", value: token, domain: url.hostname, path: "/" };
}

// Installed before any app script runs, so it sees every React commit and
// every performance entry from the very first paint.
const COLLECTOR = () => {
  window.__cg = { longTasks: [], shifts: [], events: [], commits: 0, commitLog: [], marks: [] };
  const hook = {
    renderers: new Map(),
    supportsFiber: true,
    inject(renderer) { const id = this.renderers.size + 1; this.renderers.set(id, renderer); return id; },
    onCommitFiberRoot() { window.__cg.commits += 1; window.__cg.commitLog.push(performance.now()); },
    onPostCommitFiberRoot() {},
    onCommitFiberUnmount() {},
    checkDCE() {},
    on() {}, off() {}, sub() { return () => {}; },
    emit() {}, getFiberRoots() { return new Set(); },
    isDisabled: false,
  };
  Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", { value: hook, writable: false, configurable: false });

  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__cg.longTasks.push({ start: e.startTime, duration: e.duration }); }).observe({ type: "longtask", buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cg.shifts.push({ value: e.value, start: e.startTime }); }).observe({ type: "layout-shift", buffered: true }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__cg.events.push({ name: e.name, duration: e.duration, start: e.startTime, processing: e.processingEnd - e.processingStart }); }).observe({ type: "event", buffered: true, durationThreshold: 16 }); } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__cg.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true }); } catch {}
};

const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const summarize = (xs) => xs.length ? { n: xs.length, p50: r2(pct(xs, 50)), p95: r2(pct(xs, 95)), max: r2(Math.max(...xs)) } : { n: 0, p50: null, p95: null, max: null };

async function collect(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const paint = performance.getEntriesByType("paint");
    const fcp = paint.find((p) => p.name === "first-contentful-paint")?.startTime ?? null;
    const lt = window.__cg.longTasks;
    const tbt = lt.reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0);
    const scripts = performance.getEntriesByType("resource").filter((r) => r.initiatorType === "script");
    return {
      ttfb: nav ? nav.responseStart - nav.requestStart : null,
      server_response_end: nav ? nav.responseEnd - nav.requestStart : null,
      dom_content_loaded: nav ? nav.domContentLoadedEventEnd : null,
      load: nav ? nav.loadEventEnd : null,
      fcp,
      lcp: window.__cg.lcp ?? null,
      long_tasks: { count: lt.length, total_ms: lt.reduce((s, t) => s + t.duration, 0), longest_ms: lt.length ? Math.max(...lt.map((t) => t.duration)) : 0, tbt_ms: tbt },
      cls: window.__cg.shifts.reduce((s, x) => s + x.value, 0),
      react_commits_on_load: window.__cg.commits,
      script_bytes: scripts.reduce((s, r) => s + (r.transferSize || 0), 0),
      script_count: scripts.length,
      js_heap: performance.memory ? performance.memory.usedJSHeapSize : null,
    };
  });
}

// Drives a real interaction and reads the Event Timing entries it produced,
// plus the React commits it caused. This is measured INP input, not a proxy.
async function interact(page, label, action) {
  await page.evaluate(() => { window.__cg.events = []; window.__cg.commits = 0; });
  const t0 = Date.now();
  let ok = true;
  try { await action(); } catch { ok = false; }
  // Let the interaction settle so Event Timing reports the full duration.
  await page.waitForTimeout(600);
  const res = await page.evaluate(() => ({
    events: window.__cg.events,
    commits: window.__cg.commits,
    longest_event: window.__cg.events.length ? Math.max(...window.__cg.events.map((e) => e.duration)) : null,
  }));
  return { interaction: label, ok, wall_ms: Date.now() - t0, inp_ms: r2(res.longest_event), event_count: res.events.length, react_commits: res.commits };
}

const ROUTES = [
  { name: "staff dashboard", path: "/staff" },
  { name: "clients list", path: "/staff/clients" },
  { name: "client workspace", path: "__CLIENT__" },
  { name: "appointments", path: "/staff/appointments" },
  { name: "pipeline", path: "/staff/pipeline" },
  { name: "accounting", path: "/staff/accounting" },
  { name: "reports", path: "/staff/reports" },
];

const results = [];
const cookie = await staffCookie();
const clientId = process.env.PERF_CLIENT_ID;
if (!clientId) throw new Error("PERF_CLIENT_ID is required (a synthetic client id)");

const browser = await chromium.launch({ args: ["--no-sandbox"] });

for (const vp of VIEWPORTS) {
  for (const route of ROUTES) {
    const path = route.path === "__CLIENT__" ? `/staff/client/${clientId}` : route.path;
    const perRun = [];
    const interactions = [];
    for (let run = 0; run < RUNS; run += 1) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.isMobile,
        hasTouch: vp.isMobile,
        deviceScaleFactor: vp.isMobile ? 3 : 1,
      });
      await context.addCookies([cookie]);
      const page = await context.newPage();
      await page.addInitScript(COLLECTOR);
      const cdp = await context.newCDPSession(page);
      if (CPU_THROTTLE > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_THROTTLE });
      let status = null;
      try {
        const resp = await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 60000 });
        status = resp?.status() ?? null;
        await page.waitForTimeout(1200); // let LCP/long-task observers settle
        perRun.push({ status, ...(await collect(page)) });

        // Interactions, measured once per route on the last run only, so the
        // load numbers above are not polluted by them.
        if (run === RUNS - 1) {
          if (route.name === "client workspace") {
            for (const tab of ["documents", "appointments", "work", "activity", "profile"]) {
              const btn = page.locator(`.cg-profile-tab`, { hasText: new RegExp(tab === "work" ? "Notes" : tab === "profile" ? "^Profile$" : tab, "i") }).first();
              if (await btn.count()) interactions.push(await interact(page, `tab → ${tab}`, () => btn.click({ timeout: 10000 })));
            }
          }
          const nav = page.locator('a[href="/staff/clients"]').first();
          if (await nav.count()) interactions.push(await interact(page, "nav → clients", () => nav.click({ timeout: 10000 })));
        }
      } catch (e) {
        perRun.push({ status, error: String(e).slice(0, 200) });
      }
      await context.close();
    }
    const good = perRun.filter((r) => !r.error);
    results.push({
      viewport: vp.name,
      route: route.name,
      path,
      runs: perRun.length,
      failures: perRun.filter((r) => r.error).length,
      first_error: perRun.find((r) => r.error)?.error ?? null,
      statuses: [...new Set(perRun.map((r) => r.status))],
      ttfb_ms: summarize(good.map((r) => r.ttfb).filter((v) => v != null)),
      fcp_ms: summarize(good.map((r) => r.fcp).filter((v) => v != null)),
      lcp_ms: summarize(good.map((r) => r.lcp).filter((v) => v != null)),
      load_ms: summarize(good.map((r) => r.load).filter((v) => v != null)),
      tbt_ms: summarize(good.map((r) => r.long_tasks?.tbt_ms).filter((v) => v != null)),
      long_task_count: summarize(good.map((r) => r.long_tasks?.count).filter((v) => v != null)),
      longest_task_ms: summarize(good.map((r) => r.long_tasks?.longest_ms).filter((v) => v != null)),
      cls: summarize(good.map((r) => r.cls).filter((v) => v != null)),
      react_commits_on_load: summarize(good.map((r) => r.react_commits_on_load).filter((v) => v != null)),
      script_kb: summarize(good.map((r) => (r.script_bytes ?? 0) / 1024)),
      script_count: good[0]?.script_count ?? null,
      interactions,
    });
    console.error(`[${vp.name}] ${route.name}: done (${perRun.filter((r) => r.error).length} failures)`);
  }
}

await browser.close();
const payload = { commit: sha, run_label: LABEL, base_url: BASE, runs_per_route: RUNS, cpu_throttle: CPU_THROTTLE, generated_at: new Date().toISOString(), results };
writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log(`wrote ${OUT}`);
