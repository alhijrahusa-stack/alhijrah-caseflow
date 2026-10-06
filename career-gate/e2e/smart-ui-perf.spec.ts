import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Lab measurement for the Smart path UI (Command 2). These are LAB numbers from a
 * single local Chromium run against `next start`, not field 75th-percentile data.
 * The spec records the metrics and asserts only the budgets the Smart UI itself
 * controls, so an infrastructure-slow run reports numbers without a false failure.
 */
const ROUTES = [
  { name: "smart-client-import", path: "/staff/smart-client-import/new" },
  { name: "smart-career-collect", path: "/staff/import" },
] as const;

type RouteMetrics = { route: string; scriptBytes: number; lcp: number | null; cls: number; ttfb: number | null; fcp: number | null; longTasks: number };

type Vitals = { lcp: number | null; cls: number; longTasks: number; ttfb: number | null; fcp: number | null };

/** One latency per interaction, as INP is defined. */
async function readInteractions(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const store = (window as unknown as { __cgVitals?: { interactions: Record<string, { duration: number; processing: number }> } }).__cgVitals;
    return Object.values(store?.interactions ?? {});
  });
}

async function measureRoute(page: import("@playwright/test").Page, path: string, name: string): Promise<RouteMetrics> {
  let scriptBytes = 0;
  const onResponse = async (response: import("@playwright/test").Response) => {
    const type = response.request().resourceType();
    if (type !== "script") return;
    const length = Number(response.headers()["content-length"] ?? 0);
    if (length) { scriptBytes += length; return; }
    try { scriptBytes += (await response.body()).byteLength; } catch { /* response body already discarded */ }
  };
  page.on("response", onResponse);

  await page.addInitScript(() => {
    const store = {
      lcp: null as number | null,
      cls: 0,
      longTasks: 0,
      interactions: {} as Record<string, { duration: number; processing: number }>,
    };
    (window as unknown as { __cgVitals: typeof store }).__cgVitals = store;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) store.lcp = entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
          if (!entry.hadRecentInput) store.cls += entry.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => { store.longTasks += list.getEntries().length; })
        .observe({ type: "longtask", buffered: true });
      // Interaction latency as the browser measures it. Entries are grouped by
      // interactionId exactly as INP is defined: one latency per interaction, taken as
      // the longest event in that group. Processing time is recorded separately because
      // it is the part the UI itself owns; total duration also carries input delay and
      // presentation delay, which under synthetic headless input is not representative.
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as { duration: number; interactionId?: number; processingStart: number; processingEnd: number }[]) {
          if (!entry.interactionId) continue;
          const id = String(entry.interactionId);
          const processing = entry.processingEnd - entry.processingStart;
          const current = store.interactions[id];
          store.interactions[id] = {
            duration: Math.max(current?.duration ?? 0, entry.duration),
            processing: Math.max(current?.processing ?? 0, processing),
          };
        }
      }).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
    } catch { /* observer type unsupported */ }
  });

  await page.goto(path, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const vitals: Vitals = await page.evaluate(() => {
    const store = (window as unknown as { __cgVitals?: { lcp: number | null; cls: number; longTasks: number } }).__cgVitals;
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      lcp: store?.lcp ?? null,
      cls: store?.cls ?? 0,
      longTasks: store?.longTasks ?? 0,
      ttfb: nav ? nav.responseStart - nav.requestStart : null,
      fcp: paint ? paint.startTime : null,
    };
  });
  page.off("response", onResponse);
  return { route: name, scriptBytes, ...vitals };
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] * 100) / 100;
}

test.describe("Smart path UI performance (lab)", () => {
  test("records route vitals, click acknowledgement and local field response", async ({ page, baseURL }) => {
    await signIn(page.context(), baseURL!, "admin");

    const routes: RouteMetrics[] = [];
    for (const route of ROUTES) routes.push(await measureRoute(page, route.path, route.name));

    // Click acknowledgement, measured two ways: the browser's own interaction latency
    // (the basis for INP) and the harness round trip, which includes Playwright overhead.
    await page.goto("/staff/smart-client-import/new", { waitUntil: "load" });
    const audioToggle = page.getByRole("button", { name: /audio/i }).first();
    await expect(audioToggle).toBeVisible();
    const clickAck: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const expected = (await audioToggle.getAttribute("aria-pressed")) === "true" ? "false" : "true";
      const started = performance.now();
      await audioToggle.click();
      await expect(audioToggle).toHaveAttribute("aria-pressed", expected);
      clickAck.push(performance.now() - started);
    }

    // Local field response: a single keystroke landing in the controlled source textarea.
    const source = page.locator("textarea").first();
    await expect(source).toBeVisible();
    await source.click();
    const fieldResponse: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const started = performance.now();
      await page.keyboard.type("a");
      await expect(source).toHaveValue("a".repeat(i + 1));
      fieldResponse.push(performance.now() - started);
    }

    const interactions = await readInteractions(page);
    const durations = interactions.map((entry) => entry.duration);
    const processing = interactions.map((entry) => entry.processing);
    const report = {
      kind: "LAB_DATA",
      note: "Single local Chromium run against next start with synthetic input; not field p75 data.",
      routes,
      // INP as defined: the worst interaction, and the p98 over interactions.
      inp_ms: { p50: percentile(durations, 50), p75: percentile(durations, 75), p98: percentile(durations, 98), max: durations.length ? Math.max(...durations) : null, n: durations.length },
      // The share of that latency the UI's own event handlers are responsible for.
      interaction_processing_ms: { p50: percentile(processing, 50), p75: percentile(processing, 75), p98: percentile(processing, 98), max: processing.length ? Math.max(...processing) : null },
      click_ack_harness_ms: { p50: percentile(clickAck, 50), p95: percentile(clickAck, 95) },
      local_field_response_ms: { p50: percentile(fieldResponse, 50), p95: percentile(fieldResponse, 95) },
    };
    console.log(`SMART_UI_PERF ${JSON.stringify(report)}`);

    // Budgets the Smart UI itself owns.
    for (const route of routes) expect(route.cls, `${route.route} CLS`).toBeLessThanOrEqual(0.1);
    expect(percentile(fieldResponse, 95), "local field response p95").toBeLessThanOrEqual(200);
    // The UI owns its handler cost; assert on that rather than on headless presentation.
    if (processing.length) expect(Math.max(...processing), "worst interaction processing time").toBeLessThanOrEqual(50);
  });
});
