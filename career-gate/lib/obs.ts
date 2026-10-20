import { createHash, randomBytes, randomUUID } from "node:crypto";

// Structured logs. Callers pass only non-sensitive fields; `redact` drops
// anything whose key looks secret.
const SECRET_KEY = /pass|otp|token|secret|api_?key|ssn|authorization|cookie|signature|dob|birth|a_number|identifier|^code$/i;

export function newTraceId() {
  return randomUUID();
}

export function newSpanId() {
  return randomBytes(8).toString("hex");
}

const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/;
const ZERO_TRACE = "0".repeat(32);
const ZERO_SPAN = "0".repeat(16);

/**
 * W3C Trace Context `traceparent`. Version 00 must be exactly its four fields;
 * a later version is read by its first four fields when they are followed by
 * "-" or the end, as the specification asks. Version ff and all-zero
 * identifiers are rejected.
 */
export function parseTraceparent(value: string | null | undefined): { traceId: string; parentSpanId: string; sampled: boolean } | null {
  const m = value?.trim().match(TRACEPARENT);
  if (!m || m[1] === "ff" || (m[1] === "00" && m[5] !== undefined)) return null;
  if (m[2] === ZERO_TRACE || m[3] === ZERO_SPAN) return null;
  return { traceId: m[2], parentSpanId: m[3], sampled: (parseInt(m[4], 16) & 1) === 1 };
}

export type TraceContext = { traceId: string; spanId: string; parentSpanId: string | null; sampled: boolean };

/**
 * The request's trace: a valid incoming `traceparent` joins the caller's trace
 * as a child span; otherwise `x-trace-id` / `x-request-id`, otherwise a new trace.
 */
export function traceContextFrom(req: Request): TraceContext {
  const parent = parseTraceparent(req.headers.get("traceparent"));
  if (parent) return { traceId: parent.traceId, spanId: newSpanId(), parentSpanId: parent.parentSpanId, sampled: parent.sampled };
  const h = req.headers.get("x-trace-id") ?? req.headers.get("x-request-id");
  return { traceId: h && /^[\w-]{8,100}$/.test(h) ? h : newTraceId(), spanId: newSpanId(), parentSpanId: null, sampled: false };
}

/** A `traceparent` for an outbound call made within `ctx`; non-hex legacy ids are hashed into a valid trace id. */
export function traceparentFor(ctx: TraceContext) {
  const compact = ctx.traceId.replace(/-/g, "").toLowerCase();
  const traceId = /^[0-9a-f]{32}$/.test(compact) && compact !== ZERO_TRACE
    ? compact
    : createHash("sha256").update(ctx.traceId).digest("hex").slice(0, 32);
  return `00-${traceId}-${ctx.spanId}-${ctx.sampled ? "01" : "00"}`;
}

export function traceIdFrom(req: Request) {
  return traceContextFrom(req).traceId;
}

function redact(fields: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : v;
  return out;
}

export function log(level: "info" | "warn" | "error", fields: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...redact(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Times an operation and logs route, operation, duration_ms, result and error_code. */
export async function observe<T>(
  meta: { trace_id: string; route: string; operation: string; span_id?: string; parent_span_id?: string | null },
  fn: () => Promise<T>,
  result: (v: T) => { result: string; error_code?: string | null } = () => ({ result: "ok" }),
): Promise<T> {
  const span = { ...meta, span_id: meta.span_id ?? newSpanId() };
  const t0 = performance.now();
  try {
    const v = await fn();
    const r = result(v);
    log(r.result === "ok" ? "info" : "warn", { ...span, duration_ms: Math.round(performance.now() - t0), ...r });
    return v;
  } catch (e) {
    log("error", {
      ...span,
      duration_ms: Math.round(performance.now() - t0),
      result: "exception",
      error_code: (e as { code?: string })?.code ?? "exception",
      error_message: e instanceof Error ? e.message.slice(0, 300) : "unknown",
    });
    throw e;
  }
}
