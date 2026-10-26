import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseTraceparent, traceContextFrom, traceIdFrom, traceparentFor } from "@/lib/obs";

const VALID = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

const req = (headers: Record<string, string>) => new Request("http://local.test/x", { headers });

describe("traceparent", () => {
  it("parses a valid version-00 header", () => {
    expect(parseTraceparent(VALID)).toEqual({ traceId: "4bf92f3577b34da6a3ce929d0e0e4736", parentSpanId: "00f067aa0ba902b7", sampled: true });
    expect(parseTraceparent(VALID.replace(/-01$/, "-00"))?.sampled).toBe(false);
  });

  it("rejects malformed, upper-case, version-ff, padded version-00 and all-zero identifiers", () => {
    for (const value of [
      null, "", "garbage",
      VALID.toUpperCase(),
      VALID.replace(/^00/, "ff"),
      "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
      "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
      "00-4bf92f3577b34da6a3ce929d0e0e473-00f067aa0ba902b7-01",
      `${VALID}-extra`,
      VALID.replace(/^00/, "ff") + "-extra",
    ]) expect(parseTraceparent(value)).toBeNull();
  });

  it("reads a later version by its first four fields", () => {
    const v1 = VALID.replace(/^00/, "01");
    expect(parseTraceparent(v1)?.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(parseTraceparent(`${v1}-future-field`)?.parentSpanId).toBe("00f067aa0ba902b7");
    expect(parseTraceparent(`${v1}future`)).toBeNull();
  });

  it("joins an incoming trace as a new child span", () => {
    const ctx = traceContextFrom(req({ traceparent: VALID, "x-trace-id": "ignored-legacy-id" }));
    expect(ctx.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(ctx.parentSpanId).toBe("00f067aa0ba902b7");
    expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(ctx.spanId).not.toBe(ctx.parentSpanId);
    expect(ctx.sampled).toBe(true);
  });

  it("keeps the legacy trace headers when no valid traceparent arrives", () => {
    expect(traceIdFrom(req({ "x-trace-id": "legacy-trace-0001" }))).toBe("legacy-trace-0001");
    expect(traceIdFrom(req({ traceparent: "bad", "x-request-id": "request-0002" }))).toBe("request-0002");
    expect(traceIdFrom(req({}))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("emits a valid traceparent for outbound calls, including from legacy ids", () => {
    const joined = traceContextFrom(req({ traceparent: VALID }));
    expect(traceparentFor(joined)).toBe(`00-4bf92f3577b34da6a3ce929d0e0e4736-${joined.spanId}-01`);
    const fresh = traceContextFrom(req({}));
    expect(parseTraceparent(traceparentFor(fresh))).not.toBeNull();
    const legacy = traceContextFrom(req({ "x-trace-id": "legacy-trace-0001" }));
    const expected = createHash("sha256").update("legacy-trace-0001").digest("hex").slice(0, 32);
    expect(traceparentFor(legacy)).toBe(`00-${expected}-${legacy.spanId}-00`);
  });
});
